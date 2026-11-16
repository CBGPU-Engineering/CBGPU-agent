pub mod agent;
pub mod api;
pub mod credentials;
pub mod tools;
pub mod web;
#[derive(Debug, Clone)]
pub struct Failure(pub String);
impl Failure {
    pub fn new(value: &str) -> Self {
        Self(value.into())
    }
}
impl std::fmt::Display for Failure {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.0)
    }
}
impl std::error::Error for Failure {}
pub type Result<T> = std::result::Result<T, Failure>;
pub mod engine;
