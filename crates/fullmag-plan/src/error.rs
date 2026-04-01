use std::fmt;

#[derive(Debug)]
pub struct PlanError {
    pub reasons: Vec<String>,
}

impl fmt::Display for PlanError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        for reason in &self.reasons {
            writeln!(f, "  - {}", reason)?;
        }
        Ok(())
    }
}

impl std::error::Error for PlanError {}
