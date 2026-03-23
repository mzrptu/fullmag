use anyhow::Result;
use clap::{Parser, Subcommand};
use fullmag_ir::ProblemIR;

#[derive(Parser)]
#[command(name = "fullmag")]
#[command(about = "Fullmag local bootstrap CLI")]
struct Cli {
    #[command(subcommand)]
    command: Command,
}

#[derive(Subcommand)]
enum Command {
    Doctor,
    ExampleIr,
}

fn main() -> Result<()> {
    let cli = Cli::parse();

    match cli.command {
        Command::Doctor => {
            println!("fullmag bootstrap status");
            println!("- physics-first DSL: planned");
            println!("- canonical ProblemIR: scaffolded");
            println!("- container-first dev shell: scaffolded");
            println!("- backends: pending implementation");
        }
        Command::ExampleIr => {
            let example = ProblemIR::bootstrap_example();
            println!("{}", serde_json::to_string_pretty(&example)?);
        }
    }

    Ok(())
}
