//! Quantity descriptor building and run manifest scalar extraction.

use crate::types::*;
use fullmag_runner::quantities::{quantity_specs, QuantityKind};
use fullmag_runner::FemMeshPayload;
use serde_json::Value;

pub(crate) fn build_quantities(
    latest_fields: &LatestFields,
    preview_cache: &CachedPreviewFields,
    live_state: Option<&LiveState>,
    run: Option<&RunManifest>,
    metadata: Option<&Value>,
    scalar_rows: &[ScalarRow],
    field_location: &str,
) -> Vec<QuantityDescriptor> {
    let dynamic_supported = metadata
        .and_then(|value| value.get("live_preview"))
        .and_then(|value| value.get("supported_quantities"))
        .and_then(Value::as_array)
        .map(|values| values.iter().filter_map(Value::as_str).collect::<Vec<_>>())
        .unwrap_or_default();
    let dynamic_available = |quantity_id: &str| dynamic_supported.contains(&quantity_id);
    let scalar_available = |run_value: Option<f64>| {
        !scalar_rows.is_empty() || live_state.is_some() || run_value.is_some()
    };

    quantity_specs()
        .iter()
        .filter(|spec| spec.ui_exposed)
        .map(|spec| {
            let interactive_preview = spec.interactive_preview
                && (dynamic_supported.is_empty() || dynamic_available(spec.id));
            let available = match spec.kind {
                QuantityKind::VectorField | QuantityKind::SpatialScalar => {
                    dynamic_available(spec.id)
                        || latest_fields.get(spec.id).is_some()
                        || preview_cache.get(spec.id).is_some()
                        || (spec.id == "m"
                            && live_state
                                .and_then(|state| state.latest_step.magnetization.as_ref())
                                .is_some())
                        || live_state
                            .and_then(|state| state.latest_step.preview_field.as_ref())
                            .is_some_and(|field| field.quantity == spec.id)
                }
                QuantityKind::GlobalScalar => scalar_available(
                    spec.scalar_metric_key
                        .and_then(|metric_key| run_manifest_scalar_value(run, metric_key)),
                ),
            };

            QuantityDescriptor {
                id: spec.id.to_string(),
                label: spec.label.to_string(),
                kind: spec.kind.as_api_kind().to_string(),
                unit: spec.unit.to_string(),
                location: match spec.kind {
                    QuantityKind::GlobalScalar => "global".to_string(),
                    QuantityKind::VectorField | QuantityKind::SpatialScalar => {
                        field_location.to_string()
                    }
                },
                available,
                interactive_preview,
                quick_access_label: spec.quick_access_label.map(str::to_string),
                scalar_metric_key: spec.scalar_metric_key.map(str::to_string),
            }
        })
        .collect()
}

pub(crate) fn run_manifest_scalar_value(
    run: Option<&RunManifest>,
    metric_key: &str,
) -> Option<f64> {
    match metric_key {
        "e_ex" => run.and_then(|manifest| manifest.final_e_ex),
        "e_demag" => run.and_then(|manifest| manifest.final_e_demag),
        "e_ext" => run.and_then(|manifest| manifest.final_e_ext),
        "e_total" => run.and_then(|manifest| manifest.final_e_total),
        _ => None,
    }
}

pub(crate) fn extract_fem_mesh_from_metadata(metadata: &Value) -> Option<FemMeshPayload> {
    let fem = metadata
        .get("execution_plan")?
        .get("backend_plan")?
        .get("Fem")?;
    let mesh = fem.get("mesh")?;
    serde_json::from_value(mesh.clone()).ok()
}
