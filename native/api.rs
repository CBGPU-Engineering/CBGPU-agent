use crate::{Failure, Result};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::collections::BTreeMap;
use std::time::Duration;
pub const ENDPOINT: &str = "https://cbgpu.com/api/ai/v1";
pub const MODELS: [&str; 4] = ["cbgpu-chat", "cbgpu-coder", "cbgpu-pro", "cbgpu-oss"];
#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct ToolCall {
    pub id: String,
    #[serde(rename = "type")]
    pub kind: String,
    pub function: FunctionCall,
}
#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct FunctionCall {
    pub name: String,
    pub arguments: String,
}
#[derive(Clone, Default, Debug)]
pub struct Answer {
    pub content: String,
    pub tool_calls: Vec<ToolCall>,
}
#[async_trait::async_trait]
pub trait Service: Send + Sync {
    async fn chat(
        &self,
        messages: &[Value],
        model: &str,
        effort: &str,
        tools: &Value,
        on_text: &mut (dyn for<'text> FnMut(&'text str) + Send),
    ) -> Result<Answer>;
    async fn web(&self, name: &str, args: &Value) -> Result<Value>;
    async fn models(&self) -> Result<Value>;
}
pub fn endpoint(value: &str) -> Result<String> {
    let u = reqwest::Url::parse(value).map_err(|_| Failure::new("Invalid CBGPU API endpoint."))?;
    let local = [Some("localhost"), Some("127.0.0.1"), Some("[::1]")].contains(&u.host_str());
    if !(u.scheme() == "https" || u.scheme() == "http" && local)
        || !u.username().is_empty()
        || u.password().is_some()
        || u.query().is_some()
        || u.fragment().is_some()
    {
        return Err(Failure::new(
            "Use an HTTPS API endpoint, or loopback HTTP for a local test.",
        ));
    }
    Ok(value.trim_end_matches('/').into())
}
pub fn model(value: &str) -> Result<String> {
    let value = value.strip_prefix("cbgpu/").unwrap_or(value);
    if !value.starts_with("cbgpu-")
        || !value
            .bytes()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
    {
        return Err(Failure::new(
            "Select a CBGPU model; external provider fallback is disabled.",
        ));
    }
    Ok(value.into())
}
#[derive(Clone)]
pub struct Client {
    pub base: String,
    key: String,
    http: reqwest::Client,
}
impl Client {
    pub fn new(base: &str, key: String) -> Result<Self> {
        Ok(Self {
            base: endpoint(base)?,
            key,
            http: reqwest::Client::builder()
                .timeout(Duration::from_secs(300))
                .redirect(reqwest::redirect::Policy::none())
                .build()
                .map_err(|_| Failure::new("API client unavailable."))?,
        })
    }
    async fn json(&self, path: &str, payload: Option<Value>) -> Result<Value> {
        let request = if let Some(body) = payload {
            self.http.post(format!("{}{path}", self.base)).json(&body)
        } else {
            self.http.get(format!("{}{path}", self.base))
        };
        let mut r = request.bearer_auth(&self.key).send().await.map_err(|_| {
            Failure::new("CBGPU is unreachable. Check the connection and service status.")
        })?;
        if !r.status().is_success() {
            return Err(status_error(r.status().as_u16()));
        }
        let mut bytes = Vec::new();
        while let Some(chunk) = r
            .chunk()
            .await
            .map_err(|_| Failure::new("CBGPU response interrupted."))?
        {
            if bytes.len() + chunk.len() > 1024 * 1024 {
                return Err(Failure::new("CBGPU response exceeds the supported size."));
            }
            bytes.extend_from_slice(&chunk);
        }
        serde_json::from_slice(&bytes)
            .map_err(|_| Failure::new("CBGPU returned an invalid response."))
    }
}
fn status_error(status: u16) -> Failure {
    Failure::new(match status {
        401 | 403 => {
            "CBGPU rejected the API key or account permission. Run cbgpu login or review the key on the website."
        }
        429 => {
            "CBGPU is busy or the request limit was reached. Retry after checking service status."
        }
        _ => "CBGPU inference failed. No partial tool proposals were executed.",
    })
}
#[derive(Default)]
pub struct StreamDecoder {
    buffer: Vec<u8>,
    data: Vec<String>,
    answer: Answer,
    pending: BTreeMap<usize, ToolCall>,
    complete: bool,
}
impl StreamDecoder {
    pub fn push(
        &mut self,
        bytes: &[u8],
        on_text: &mut (dyn for<'text> FnMut(&'text str) + Send),
    ) -> Result<()> {
        for byte in bytes {
            if *byte != b'\n' {
                self.buffer.push(*byte);
                if self.buffer.len() > 1024 * 1024 {
                    return Err(Failure::new("Inference frame exceeds the supported size."));
                }
                continue;
            }
            let line = String::from_utf8(std::mem::take(&mut self.buffer))
                .map_err(|_| Failure::new("Invalid inference encoding."))?;
            let line = line.trim_end_matches('\r');
            if line.is_empty() {
                self.event(on_text)?;
            } else if let Some(data) = line.strip_prefix("data:") {
                if self.data.iter().map(String::len).sum::<usize>() + data.len() > 1024 * 1024 {
                    return Err(Failure::new("Inference event too large."));
                }
                self.data.push(data.trim_start().into());
            }
        }
        Ok(())
    }
    fn event(&mut self, on_text: &mut (dyn for<'text> FnMut(&'text str) + Send)) -> Result<()> {
        if self.data.is_empty() {
            return Ok(());
        }
        let raw = std::mem::take(&mut self.data).join("\n");
        if raw == "[DONE]" {
            self.complete = true;
            return Ok(());
        }
        let value: Value =
            serde_json::from_str(&raw).map_err(|_| Failure::new("Invalid inference event."))?;
        if value.get("error").is_some() {
            return Err(Failure::new(
                "CBGPU inference failed; no partial tool proposals were executed.",
            ));
        }
        for choice in value["choices"].as_array().into_iter().flatten() {
            if choice["finish_reason"]
                .as_str()
                .is_some_and(|s| !matches!(s, "stop" | "tool_calls"))
            {
                return Err(Failure::new(
                    "Inference was truncated; no partial tools were executed.",
                ));
            }
            if choice["finish_reason"].as_str().is_some() {
                self.complete = true;
            }
            let delta = &choice["delta"];
            if let Some(text) = delta["content"].as_str() {
                if self.answer.content.len() + text.len() > 1024 * 1024 {
                    return Err(Failure::new("Inference output exceeds the supported size."));
                }
                self.answer.content.push_str(text);
                on_text(text);
            }
            for tool in delta["tool_calls"].as_array().into_iter().flatten() {
                let index = tool["index"].as_u64().unwrap_or(0) as usize;
                if index >= 20 {
                    return Err(Failure::new("Too many tool proposals."));
                }
                let call = self.pending.entry(index).or_insert_with(|| ToolCall {
                    id: String::new(),
                    kind: "function".into(),
                    function: FunctionCall {
                        name: String::new(),
                        arguments: String::new(),
                    },
                });
                if let Some(id) = tool["id"].as_str() {
                    call.id = id.into();
                }
                if let Some(name) = tool.pointer("/function/name").and_then(Value::as_str) {
                    call.function.name.push_str(name);
                }
                if let Some(args) = tool.pointer("/function/arguments").and_then(Value::as_str) {
                    call.function.arguments.push_str(args);
                }
                if call.id.len() > 128
                    || call.function.name.len() > 100
                    || call.function.arguments.len() > 24000
                {
                    return Err(Failure::new("Tool proposal exceeds the supported size."));
                }
            }
        }
        Ok(())
    }
    pub fn finish(
        mut self,
        on_text: &mut (dyn for<'text> FnMut(&'text str) + Send),
    ) -> Result<Answer> {
        if !self.buffer.is_empty() {
            self.push(b"\n", on_text)?;
        }
        self.event(on_text)?;
        if !self.complete {
            return Err(Failure::new(
                "Inference connection ended before completion. Partial tool proposals were not executed.",
            ));
        }
        self.answer.tool_calls = self.pending.into_values().collect();
        for call in &self.answer.tool_calls {
            if call.id.is_empty()
                || call.function.name.is_empty()
                || !serde_json::from_str::<Value>(&call.function.arguments)
                    .is_ok_and(|v| v.is_object())
            {
                return Err(Failure::new("CBGPU returned an invalid tool proposal."));
            }
        }
        Ok(self.answer)
    }
}
#[async_trait::async_trait]
impl Service for Client {
    async fn chat(
        &self,
        messages: &[Value],
        selection: &str,
        effort: &str,
        tools: &Value,
        on_text: &mut (dyn for<'text> FnMut(&'text str) + Send),
    ) -> Result<Answer> {
        let selected = model(selection)?;
        if !["low", "medium", "high"].contains(&effort) {
            return Err(Failure::new("Use reasoning effort low, medium or high."));
        }
        let payload = json!({"model":selected,"messages":messages,"tools":tools,"stream":true,"reasoning_effort":effort,"max_tokens":if selected=="cbgpu-oss"{4096}else{2048}});
        let mut response = self
            .http
            .post(format!("{}/chat/completions", self.base))
            .bearer_auth(&self.key)
            .json(&payload)
            .send()
            .await
            .map_err(|_| Failure::new("CBGPU inference connection failed."))?;
        if !response.status().is_success() {
            return Err(status_error(response.status().as_u16()));
        }
        if response
            .headers()
            .get("content-type")
            .and_then(|v| v.to_str().ok())
            .is_some_and(|v| v.contains("application/json"))
        {
            let mut bytes = Vec::new();
            while let Some(part) = response
                .chunk()
                .await
                .map_err(|_| Failure::new("Inference response interrupted."))?
            {
                if bytes.len() + part.len() > 1024 * 1024 {
                    return Err(Failure::new("Inference response too large."));
                }
                bytes.extend_from_slice(&part);
            }
            let value: Value = serde_json::from_slice(&bytes)
                .map_err(|_| Failure::new("Invalid inference response."))?;
            if value["choices"][0]["finish_reason"]
                .as_str()
                .is_some_and(|s| !matches!(s, "stop" | "tool_calls"))
            {
                return Err(Failure::new(
                    "Inference was truncated; no partial tools were executed.",
                ));
            }
            let message = &value["choices"][0]["message"];
            if !message.is_object() {
                return Err(Failure::new("No visible inference response returned."));
            }
            let answer = Answer {
                content: message["content"].as_str().unwrap_or_default().into(),
                tool_calls: serde_json::from_value(
                    message
                        .get("tool_calls")
                        .cloned()
                        .unwrap_or_else(|| json!([])),
                )
                .map_err(|_| Failure::new("Invalid tool proposal."))?,
            };
            if answer.tool_calls.len() > 20
                || answer.tool_calls.iter().any(|c| {
                    c.kind != "function"
                        || c.id.is_empty()
                        || c.id.len() > 128
                        || c.function.name.is_empty()
                        || c.function.name.len() > 100
                        || c.function.arguments.len() > 24000
                        || !serde_json::from_str::<Value>(&c.function.arguments)
                            .is_ok_and(|v| v.is_object())
                })
            {
                return Err(Failure::new("Invalid tool proposal."));
            }
            on_text(&answer.content);
            return Ok(answer);
        }
        let mut decoder = StreamDecoder::default();
        while let Some(part) = response.chunk().await.map_err(|_| {
            Failure::new(
                "Inference connection interrupted. Partial tool proposals were not executed.",
            )
        })? {
            decoder.push(&part, on_text)?;
        }
        decoder.finish(on_text)
    }
    async fn web(&self, name: &str, args: &Value) -> Result<Value> {
        let (path, body) = match name {
            "web_search" => ("/web/search", json!({"query":args["query"]})),
            "read_web_page" => ("/web/read", json!({"url":args["url"]})),
            _ => return Err(Failure::new("Unknown read-only web tool.")),
        };
        self.json(path, Some(body)).await
    }
    async fn models(&self) -> Result<Value> {
        self.json("/models", None).await
    }
}
