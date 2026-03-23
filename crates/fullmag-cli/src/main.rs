use anyhow::{anyhow, bail, Result};
use clap::{Parser, Subcommand, ValueEnum};
use fullmag_ir::{BackendTarget, ProblemIR};
use std::{fs, path::PathBuf};

#[derive(Parser)]
#[command(name = "fullmag")]
#[command(about = "Fullmag bootstrap CLI for Python-built ProblemIR validation and planning")]
struct Cli {
    #[command(subcommand)]
    command: Command,
}

#[derive(Subcommand)]
enum Command {
    Doctor,
    ExampleIr,
    ValidateJson { path: PathBuf },
    PlanJson {
        path: PathBuf,
        #[arg(long)]
        backend: Option<BackendArg>,
    },
}

#[derive(Debug, Clone, Copy, ValueEnum)]
enum BackendArg {
    Auto,
    Fdm,
    Fem,
    Hybrid,
}

impl From<BackendArg> for BackendTarget {
    fn from(value: BackendArg) -> Self {
        match value {
            BackendArg::Auto => BackendTarget::Auto,
            BackendArg::Fdm => BackendTarget::Fdm,
            BackendArg::Fem => BackendTarget::Fem,
            BackendArg::Hybrid => BackendTarget::Hybrid,
        }
    }
}

fn main() -> Result<()> {
    let cli = Cli::parse();

    match cli.command {
        Command::Doctor => {
            println!("fullmag bootstrap status");
            println!("- embedded Python DSL: scaffolded");
            println!("- public package fullmag: scaffolded");
            println!("- canonical ProblemIR: typed + validated");
            println!("- physics-first documentation gate: scaffolded");
            println!("- backends: planning-only");
        }
        Command::ExampleIr => {
            let example = ProblemIR::bootstrap_example();
            println!("{}", serde_json::to_string_pretty(&example)?);
        }
        Command::ValidateJson { path } => {
            let ir = read_ir(&path)?;
            validate_ir(&ir)?;
            println!("IR validation passed for {}", path.display());
        }
        Command::PlanJson { path, backend } => {
            let ir = read_ir(&path)?;
            validate_ir(&ir)?;
            let plan = ir.plan_for(backend.map(BackendTarget::from)).map_err(join_errors)?;
            println!("{}", serde_json::to_string_pretty(&plan)?);
        }
    }

    Ok(())
}

fn read_ir(path: &PathBuf) -> Result<ProblemIR> {
    let text = fs::read_to_string(path)
        .map_err(|error| anyhow!("failed to read {}: {}", path.display(), error))?;
    serde_json::from_str(&text)
        .map_err(|error| anyhow!("failed to deserialize {}: {}", path.display(), error))
}

fn validate_ir(ir: &ProblemIR) -> Result<()> {
    ir.validate().map_err(join_errors)?;
    if ir.problem_meta.script_language != "python" {
        bail!("Only Python-authored ProblemIR is supported in bootstrap mode")
    }
    Ok(())
}

fn join_errors(errors: Vec<String>) -> anyhow::Error {
    anyhow!(errors.join("; "))
}
