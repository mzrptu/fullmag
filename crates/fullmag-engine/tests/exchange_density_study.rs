use fullmag_engine::studies::run_default_exchange_density_study;

#[test]
fn fdm_fem_exchange_gap_shrinks_with_refinement() {
    let study = run_default_exchange_density_study().expect("study should run");
    assert!(study.pairs.len() >= 3, "expected at least 3 density levels");

    let first = &study.pairs[0];
    let last = study.pairs.last().expect("last pair");

    assert!(
        last.relative_energy_gap < first.relative_energy_gap,
        "relative energy gap should shrink with refinement: first={} last={}",
        first.relative_energy_gap,
        last.relative_energy_gap,
    );
    assert!(
        last.relative_center_field_gap < first.relative_center_field_gap,
        "relative center exchange-field gap should shrink with refinement: first={} last={}",
        first.relative_center_field_gap,
        last.relative_center_field_gap,
    );
    assert!(
        last.relative_energy_gap < 0.35,
        "finest relative energy gap should be reasonably small, got {}",
        last.relative_energy_gap,
    );
    assert!(
        last.relative_center_field_gap < 0.35,
        "finest relative center field gap should be reasonably small, got {}",
        last.relative_center_field_gap,
    );
}
