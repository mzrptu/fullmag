use fullmag_engine::studies::{
    run_default_exchange_density_study, write_exchange_density_csv, write_exchange_density_svg,
};
use std::path::PathBuf;

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let study = run_default_exchange_density_study()?;
    let root = PathBuf::from(".fullmag/studies");
    let csv_path = root.join("exchange_density_fdm_fem.csv");
    let svg_path = root.join("exchange_density_fdm_fem.svg");
    write_exchange_density_csv(&study, &csv_path)?;
    write_exchange_density_svg(&study, &svg_path)?;

    println!("exchange density study written:");
    println!("- {}", csv_path.display());
    println!("- {}", svg_path.display());
    for pair in study.pairs {
        println!(
            "{} | gap_E={:.4} | gap_Hex_center={:.4}",
            pair.level_label, pair.relative_energy_gap, pair.relative_center_field_gap
        );
    }
    Ok(())
}
