use crate::{
    validate_scene_document, MagnetizationAsset, MagnetizationMapping, SceneCurrentModulesState,
    SceneDocument, SceneDocumentValidationError, SceneEditorState, SceneGeometry,
    SceneMaterialAsset, SceneMetadata, SceneObject, SceneOutputsState, SceneStudyState,
    ScriptBuilderGeometryEntry, ScriptBuilderMagnetizationState, ScriptBuilderState,
    TextureTransform3D, Transform3D,
};
use serde_json::{Map, Value};
use std::collections::BTreeMap;

#[derive(Debug, Clone, PartialEq)]
pub struct SceneProblemProjection {
    pub builder: ScriptBuilderState,
    pub rewrite_overrides: Value,
}

pub fn scene_document_from_script_builder(builder: &ScriptBuilderState) -> SceneDocument {
    let objects = builder
        .geometries
        .iter()
        .map(scene_object_from_geometry)
        .collect::<Vec<_>>();
    let materials = builder
        .geometries
        .iter()
        .map(|geometry| SceneMaterialAsset {
            id: material_id_for_geometry(&geometry.name),
            name: format!("{} material", geometry.name),
            properties: geometry.material.clone(),
        })
        .collect::<Vec<_>>();
    let magnetization_assets = builder
        .geometries
        .iter()
        .map(|geometry| magnetization_asset_from_geometry(&geometry.name, &geometry.magnetization))
        .collect::<Vec<_>>();

    SceneDocument {
        version: "scene.v1".to_string(),
        revision: builder.revision,
        scene: SceneMetadata {
            id: "scene".to_string(),
            name: "Scene".to_string(),
        },
        universe: builder.universe.clone(),
        objects,
        materials,
        magnetization_assets,
        current_modules: SceneCurrentModulesState {
            modules: builder.current_modules.clone(),
            excitation_analysis: builder.excitation_analysis.clone(),
        },
        study: SceneStudyState {
            backend: builder.backend.clone(),
            solver: builder.solver.clone(),
            mesh_defaults: builder.mesh.clone(),
            stages: builder.stages.clone(),
            initial_state: builder.initial_state.clone(),
        },
        outputs: SceneOutputsState::default(),
        editor: SceneEditorState::default(),
    }
}

pub fn scene_document_to_script_builder(
    scene: &SceneDocument,
) -> Result<ScriptBuilderState, SceneDocumentValidationError> {
    validate_scene_document(scene)?;
    let materials = scene
        .materials
        .iter()
        .map(|material| (material.id.clone(), material.properties.clone()))
        .collect::<BTreeMap<_, _>>();
    let magnetization_assets = scene
        .magnetization_assets
        .iter()
        .map(|asset| (asset.id.clone(), asset.clone()))
        .collect::<BTreeMap<_, _>>();

    let geometries = scene
        .objects
        .iter()
        .map(|object| {
            let material = materials
                .get(&object.material_ref)
                .cloned()
                .ok_or_else(|| {
                    SceneDocumentValidationError::new(format!(
                        "missing material '{}' for object '{}'",
                        object.material_ref, object.id
                    ))
                })?;
            let magnetization_ref = object
                .magnetization_ref
                .as_ref()
                .filter(|reference| !reference.trim().is_empty())
                .ok_or_else(|| {
                    SceneDocumentValidationError::new(format!(
                        "missing magnetization reference for object '{}'",
                        object.id
                    ))
                })?;
            let magnetization = magnetization_assets
                .get(magnetization_ref)
                .map(script_builder_magnetization_from_asset)
                .ok_or_else(|| {
                    SceneDocumentValidationError::new(format!(
                        "missing magnetization '{}' for object '{}'",
                        magnetization_ref, object.id
                    ))
                })?;

            let mut geometry_params = object.geometry.geometry_params.clone();
            strip_translation_fields(&mut geometry_params);
            if !is_zero_vec3(object.transform.translation) {
                insert_translation(&mut geometry_params, object.transform.translation);
            }

            Ok(ScriptBuilderGeometryEntry {
                name: builder_geometry_name_for_object(object),
                region_name: object.region_name.clone(),
                geometry_kind: object.geometry.geometry_kind.clone(),
                geometry_params,
                bounds_min: object.geometry.bounds_min,
                bounds_max: object.geometry.bounds_max,
                material,
                magnetization,
                mesh: object.mesh_override.clone(),
            })
        })
        .collect::<Result<Vec<_>, SceneDocumentValidationError>>()?;

    Ok(ScriptBuilderState {
        revision: scene.revision,
        backend: scene.study.backend.clone(),
        solver: scene.study.solver.clone(),
        mesh: scene.study.mesh_defaults.clone(),
        universe: scene.universe.clone(),
        domain_frame: None,
        stages: scene.study.stages.clone(),
        initial_state: scene.study.initial_state.clone(),
        geometries,
        current_modules: scene.current_modules.modules.clone(),
        excitation_analysis: scene.current_modules.excitation_analysis.clone(),
    })
}

pub fn scene_document_to_script_builder_overrides(
    scene: &SceneDocument,
) -> Result<Value, SceneDocumentValidationError> {
    let builder = scene_document_to_script_builder(scene)?;
    Ok(serde_json::json!({
        "solver": {
            "integrator": string_or_null(&builder.solver.integrator),
            "fixed_timestep": parse_optional_text_f64(&builder.solver.fixed_timestep),
            "relax": {
                "algorithm": string_or_null(&builder.solver.relax_algorithm),
                "torque_tolerance": parse_optional_text_f64(&builder.solver.torque_tolerance),
                "energy_tolerance": parse_optional_text_f64(&builder.solver.energy_tolerance),
                "max_steps": parse_optional_text_u64(&builder.solver.max_relax_steps),
            },
        },
        "mesh": {
            "algorithm_2d": builder.mesh.algorithm_2d,
            "algorithm_3d": builder.mesh.algorithm_3d,
            "hmax": parse_optional_text_f64_or_auto(&builder.mesh.hmax),
            "hmin": parse_optional_text_f64(&builder.mesh.hmin),
            "size_factor": builder.mesh.size_factor,
            "size_from_curvature": builder.mesh.size_from_curvature,
            "growth_rate": parse_optional_text_f64(&builder.mesh.growth_rate),
            "narrow_regions": builder.mesh.narrow_regions,
            "smoothing_steps": builder.mesh.smoothing_steps,
            "optimize": string_or_null(&builder.mesh.optimize),
            "optimize_iterations": builder.mesh.optimize_iterations,
            "compute_quality": builder.mesh.compute_quality,
            "per_element_quality": builder.mesh.per_element_quality,
            "adaptive_mesh": if !builder.mesh.adaptive_enabled {
                Value::Null
            } else {
                serde_json::json!({
                    "enabled": builder.mesh.adaptive_enabled,
                    "policy": builder.mesh.adaptive_policy,
                    "theta": builder.mesh.adaptive_theta,
                    "h_min": parse_optional_text_f64(&builder.mesh.adaptive_h_min),
                    "h_max": parse_optional_text_f64(&builder.mesh.adaptive_h_max),
                    "max_passes": builder.mesh.adaptive_max_passes,
                    "error_tolerance": parse_optional_text_f64(&builder.mesh.adaptive_error_tolerance),
                })
            },
        },
        "universe": builder.universe.as_ref().map(|universe| serde_json::json!({
            "mode": universe.mode,
            "size": universe.size,
            "center": universe.center,
            "padding": universe.padding,
        })).unwrap_or(Value::Null),
        "stages": builder.stages.iter().map(|stage| serde_json::json!({
            "kind": stage.kind,
            "entrypoint_kind": stage.entrypoint_kind,
            "integrator": string_or_null(&stage.integrator),
            "fixed_timestep": parse_optional_text_f64(&stage.fixed_timestep),
            "until_seconds": parse_optional_text_f64(&stage.until_seconds),
            "relax_algorithm": string_or_null(&stage.relax_algorithm),
            "torque_tolerance": parse_optional_text_f64(&stage.torque_tolerance),
            "energy_tolerance": parse_optional_text_f64(&stage.energy_tolerance),
            "max_steps": parse_optional_text_u64(&stage.max_steps),
        })).collect::<Vec<_>>(),
        "initial_state": builder.initial_state.as_ref().map(|initial_state| serde_json::json!({
            "magnet_name": initial_state.magnet_name,
            "source_path": initial_state.source_path,
            "format": initial_state.format,
            "dataset": initial_state.dataset,
            "sample_index": initial_state.sample_index,
        })).unwrap_or(Value::Null),
        "geometries": builder.geometries.iter().map(|geo| serde_json::json!({
            "name": geo.name,
            "region_name": geo.region_name,
            "geometry_kind": geo.geometry_kind,
            "geometry_params": geo.geometry_params,
            "bounds_min": geo.bounds_min,
            "bounds_max": geo.bounds_max,
            "material": {
                "Ms": geo.material.ms,
                "Aex": geo.material.aex,
                "alpha": geo.material.alpha,
                "Dind": geo.material.dind,
            },
            "magnetization": {
                "kind": geo.magnetization.kind,
                "value": geo.magnetization.value,
                "seed": geo.magnetization.seed,
                "source_path": geo.magnetization.source_path,
                "source_format": geo.magnetization.source_format,
                "dataset": geo.magnetization.dataset,
                "sample_index": geo.magnetization.sample_index,
            },
            "mesh": geo.mesh.as_ref().map(|mesh| serde_json::json!({
                "mode": mesh.mode,
                "hmax": parse_optional_text_f64_or_auto(&mesh.hmax),
                "hmin": parse_optional_text_f64(&mesh.hmin),
                "order": mesh.order,
                "source": mesh.source,
                "algorithm_2d": mesh.algorithm_2d,
                "algorithm_3d": mesh.algorithm_3d,
                "size_factor": mesh.size_factor,
                "size_from_curvature": mesh.size_from_curvature,
                "growth_rate": parse_optional_text_f64(&mesh.growth_rate),
                "narrow_regions": mesh.narrow_regions,
                "smoothing_steps": mesh.smoothing_steps,
                "optimize": mesh.optimize,
                "optimize_iterations": mesh.optimize_iterations,
                "compute_quality": mesh.compute_quality,
                "per_element_quality": mesh.per_element_quality,
                "size_fields": mesh.size_fields.iter().map(|field| serde_json::json!({
                    "kind": field.kind,
                    "params": field.params,
                })).collect::<Vec<_>>(),
                "operations": mesh.operations.iter().map(|operation| serde_json::json!({
                    "kind": operation.kind,
                    "params": operation.params,
                })).collect::<Vec<_>>(),
                "build_requested": mesh.build_requested,
            })),
        })).collect::<Vec<_>>(),
        "current_modules": builder.current_modules.iter().map(|module| serde_json::json!({
            "kind": module.kind,
            "name": module.name,
            "solver": module.solver,
            "air_box_factor": module.air_box_factor,
            "antenna_kind": module.antenna_kind,
            "antenna_params": module.antenna_params,
            "drive": {
                "current_a": module.drive.current_a,
                "frequency_hz": module.drive.frequency_hz,
                "phase_rad": module.drive.phase_rad,
                "waveform": module.drive.waveform,
            },
        })).collect::<Vec<_>>(),
        "excitation_analysis": builder.excitation_analysis.as_ref().map(|analysis| serde_json::json!({
            "source": analysis.source,
            "method": analysis.method,
            "propagation_axis": analysis.propagation_axis,
            "k_max_rad_per_m": analysis.k_max_rad_per_m,
            "samples": analysis.samples,
        })).unwrap_or(Value::Null),
    }))
}

pub fn scene_document_problem_projection(
    scene: &SceneDocument,
) -> Result<SceneProblemProjection, SceneDocumentValidationError> {
    let builder = scene_document_to_script_builder(scene)?;
    let rewrite_overrides = scene_document_to_script_builder_overrides(scene)?;
    Ok(SceneProblemProjection {
        builder,
        rewrite_overrides,
    })
}

fn scene_object_from_geometry(geometry: &ScriptBuilderGeometryEntry) -> SceneObject {
    let (geometry_params, translation) = split_top_level_translation(&geometry.geometry_params);
    SceneObject {
        id: geometry.name.clone(),
        name: geometry.name.clone(),
        geometry: SceneGeometry {
            geometry_kind: geometry.geometry_kind.clone(),
            geometry_params,
            bounds_min: geometry.bounds_min,
            bounds_max: geometry.bounds_max,
        },
        transform: Transform3D {
            translation,
            ..Transform3D::default()
        },
        material_ref: material_id_for_geometry(&geometry.name),
        region_name: geometry.region_name.clone(),
        magnetization_ref: Some(magnetization_id_for_geometry(&geometry.name)),
        mesh_override: geometry.mesh.clone(),
        visible: true,
        locked: false,
        tags: Vec::new(),
    }
}

fn builder_geometry_name_for_object(object: &SceneObject) -> String {
    if object.name.trim().is_empty() {
        object.id.clone()
    } else {
        object.name.clone()
    }
}

fn material_id_for_geometry(name: &str) -> String {
    format!("mat:{name}")
}

fn magnetization_id_for_geometry(name: &str) -> String {
    format!("mag:{name}")
}

fn magnetization_asset_from_geometry(
    name: &str,
    magnetization: &ScriptBuilderMagnetizationState,
) -> MagnetizationAsset {
    let kind = if magnetization.kind == "file"
        && (magnetization.dataset.is_some() || magnetization.sample_index.is_some())
    {
        "sampled".to_string()
    } else {
        magnetization.kind.clone()
    };
    MagnetizationAsset {
        id: magnetization_id_for_geometry(name),
        name: format!("{} magnetization", name),
        kind,
        value: magnetization.value.clone(),
        seed: magnetization.seed,
        source_path: magnetization.source_path.clone(),
        source_format: magnetization.source_format.clone(),
        dataset: magnetization.dataset.clone(),
        sample_index: magnetization.sample_index,
        mapping: MagnetizationMapping::default(),
        texture_transform: TextureTransform3D::default(),
    }
}

fn script_builder_magnetization_from_asset(
    asset: &MagnetizationAsset,
) -> ScriptBuilderMagnetizationState {
    ScriptBuilderMagnetizationState {
        kind: asset.kind.clone(),
        value: asset.value.clone(),
        seed: asset.seed,
        source_path: asset.source_path.clone(),
        source_format: asset.source_format.clone(),
        dataset: asset.dataset.clone(),
        sample_index: asset.sample_index,
    }
}

fn split_top_level_translation(value: &Value) -> (Value, [f64; 3]) {
    let mut translation = [0.0, 0.0, 0.0];
    let mut params = match value {
        Value::Object(map) => map.clone(),
        _ => return (value.clone(), translation),
    };
    for key in ["translation", "translate"] {
        if let Some(raw) = params.remove(key) {
            if let Some(vec3) = read_vec3(&raw) {
                translation = vec3;
                break;
            }
        }
    }
    (Value::Object(params), translation)
}

fn strip_translation_fields(value: &mut Value) {
    if let Value::Object(map) = value {
        map.remove("translation");
        map.remove("translate");
    }
}

fn insert_translation(value: &mut Value, translation: [f64; 3]) {
    match value {
        Value::Object(map) => {
            map.insert(
                "translation".to_string(),
                Value::Array(translation.into_iter().map(Value::from).collect()),
            );
        }
        _ => {
            let mut map = Map::new();
            map.insert(
                "translation".to_string(),
                Value::Array(translation.into_iter().map(Value::from).collect()),
            );
            *value = Value::Object(map);
        }
    }
}

fn read_vec3(value: &Value) -> Option<[f64; 3]> {
    match value {
        Value::Array(values) if values.len() == 3 => Some([
            values[0].as_f64()?,
            values[1].as_f64()?,
            values[2].as_f64()?,
        ]),
        _ => None,
    }
}

fn is_zero_vec3(value: [f64; 3]) -> bool {
    value
        .iter()
        .all(|component| component.abs() <= f64::EPSILON)
}

fn string_or_null(value: &str) -> Value {
    if value.trim().is_empty() {
        Value::Null
    } else {
        Value::String(value.to_string())
    }
}

fn parse_optional_text_f64(raw: &str) -> Value {
    raw.trim()
        .parse::<f64>()
        .ok()
        .map_or(Value::Null, Value::from)
}

fn parse_optional_text_f64_or_auto(raw: &str) -> Value {
    let trimmed = raw.trim();
    if trimmed.eq_ignore_ascii_case("auto") {
        return Value::String("auto".to_string());
    }
    parse_optional_text_f64(trimmed)
}

fn parse_optional_text_u64(raw: &str) -> Value {
    raw.trim()
        .parse::<u64>()
        .ok()
        .map_or(Value::Null, Value::from)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        ScriptBuilderCurrentModuleState, ScriptBuilderDriveState, ScriptBuilderInitialState,
        ScriptBuilderMaterialState, ScriptBuilderMeshOperationState,
        ScriptBuilderMeshSizeFieldState, ScriptBuilderMeshState, ScriptBuilderPerGeometryMeshState,
        ScriptBuilderSolverState, ScriptBuilderStageState,
    };

    fn sample_builder() -> ScriptBuilderState {
        ScriptBuilderState {
            revision: 7,
            backend: Some("fem".to_string()),
            solver: ScriptBuilderSolverState {
                integrator: "rk45".to_string(),
                fixed_timestep: "1e-15".to_string(),
                relax_algorithm: "llg_overdamped".to_string(),
                torque_tolerance: "1e-6".to_string(),
                energy_tolerance: String::new(),
                max_relax_steps: "1000".to_string(),
            },
            mesh: ScriptBuilderMeshState {
                algorithm_2d: 6,
                algorithm_3d: 1,
                hmax: "20e-9".to_string(),
                hmin: String::new(),
                size_factor: 1.0,
                size_from_curvature: 0,
                growth_rate: String::new(),
                narrow_regions: 0,
                smoothing_steps: 1,
                optimize: "Netgen".to_string(),
                optimize_iterations: 2,
                compute_quality: true,
                per_element_quality: false,
                adaptive_enabled: false,
                adaptive_policy: "auto".to_string(),
                adaptive_theta: 0.3,
                adaptive_h_min: String::new(),
                adaptive_h_max: String::new(),
                adaptive_max_passes: 2,
                adaptive_error_tolerance: "1e-3".to_string(),
            },
            universe: None,
            domain_frame: None,
            stages: vec![ScriptBuilderStageState {
                kind: "run".to_string(),
                entrypoint_kind: "study".to_string(),
                integrator: "rk45".to_string(),
                fixed_timestep: String::new(),
                until_seconds: "1e-9".to_string(),
                relax_algorithm: String::new(),
                torque_tolerance: String::new(),
                energy_tolerance: String::new(),
                max_steps: String::new(),
            }],
            initial_state: Some(ScriptBuilderInitialState {
                magnet_name: Some("flower".to_string()),
                source_path: "/tmp/m0.ovf".to_string(),
                format: "ovf".to_string(),
                dataset: Some("values".to_string()),
                sample_index: Some(0),
            }),
            geometries: vec![ScriptBuilderGeometryEntry {
                name: "flower".to_string(),
                region_name: Some("core".to_string()),
                geometry_kind: "ImportedGeometry".to_string(),
                geometry_params: serde_json::json!({
                    "source": "flower.stl",
                    "units": "nm",
                    "translation": [1.0, 2.0, 3.0],
                }),
                bounds_min: Some([-1.0, -2.0, -3.0]),
                bounds_max: Some([1.0, 2.0, 3.0]),
                material: ScriptBuilderMaterialState {
                    ms: Some(752e3),
                    aex: Some(15.5e-12),
                    alpha: 0.1,
                    dind: None,
                },
                magnetization: ScriptBuilderMagnetizationState {
                    kind: "sampled".to_string(),
                    value: None,
                    seed: None,
                    source_path: Some("m0.ovf".to_string()),
                    source_format: Some("ovf".to_string()),
                    dataset: Some("values".to_string()),
                    sample_index: Some(3),
                },
                mesh: Some(ScriptBuilderPerGeometryMeshState {
                    mode: "custom".to_string(),
                    hmax: "10e-9".to_string(),
                    hmin: String::new(),
                    order: Some(1),
                    source: None,
                    algorithm_2d: Some(6),
                    algorithm_3d: Some(10),
                    size_factor: Some(0.8),
                    size_from_curvature: Some(16),
                    growth_rate: "1.6".to_string(),
                    narrow_regions: Some(2),
                    smoothing_steps: Some(3),
                    optimize: Some("Netgen".to_string()),
                    optimize_iterations: Some(4),
                    compute_quality: Some(true),
                    per_element_quality: Some(false),
                    size_fields: vec![ScriptBuilderMeshSizeFieldState {
                        kind: "Ball".to_string(),
                        params: serde_json::json!({ "VIn": 1e-9 }),
                    }],
                    operations: vec![ScriptBuilderMeshOperationState {
                        kind: "smooth".to_string(),
                        params: serde_json::json!({ "iterations": 2 }),
                    }],
                    build_requested: true,
                }),
            }],
            current_modules: vec![ScriptBuilderCurrentModuleState {
                kind: "antenna_field_source".to_string(),
                name: "cpw_1".to_string(),
                solver: "mqs_2p5d_az".to_string(),
                air_box_factor: 12.0,
                antenna_kind: "CPWAntenna".to_string(),
                antenna_params: serde_json::json!({ "gap": 1e-6 }),
                drive: ScriptBuilderDriveState {
                    current_a: 0.01,
                    frequency_hz: Some(10e9),
                    phase_rad: 0.0,
                    waveform: None,
                },
            }],
            excitation_analysis: Some(crate::ScriptBuilderExcitationAnalysisState {
                source: "cpw_1".to_string(),
                method: "dispersion".to_string(),
                propagation_axis: [1.0, 0.0, 0.0],
                k_max_rad_per_m: Some(1e7),
                samples: 256,
            }),
        }
    }

    #[test]
    fn scene_document_round_trips_script_builder_state() {
        let builder = sample_builder();
        let scene = scene_document_from_script_builder(&builder);
        let round_trip = scene_document_to_script_builder(&scene).expect("scene should validate");

        assert_eq!(round_trip.revision, builder.revision);
        assert_eq!(round_trip.backend, builder.backend);
        assert_eq!(round_trip.solver, builder.solver);
        assert_eq!(round_trip.mesh, builder.mesh);
        assert_eq!(round_trip.initial_state, builder.initial_state);
        assert_eq!(round_trip.current_modules, builder.current_modules);
        assert_eq!(round_trip.excitation_analysis, builder.excitation_analysis);
        assert_eq!(
            round_trip.geometries[0].geometry_params.get("translation"),
            Some(&serde_json::json!([1.0, 2.0, 3.0]))
        );
        assert_eq!(round_trip.geometries[0].magnetization.kind, "sampled");
    }

    #[test]
    fn scene_document_validation_rejects_missing_refs() {
        let mut scene = scene_document_from_script_builder(&sample_builder());
        scene.objects[0].material_ref = "missing".to_string();
        let error =
            scene_document_to_script_builder(&scene).expect_err("missing material must fail");
        assert!(error.message.contains("missing material"));

        let mut scene = scene_document_from_script_builder(&sample_builder());
        scene.objects[0].magnetization_ref = None;
        let error = scene_document_to_script_builder(&scene)
            .expect_err("missing magnetization ref must fail");
        assert!(error
            .message
            .contains("must reference a magnetization asset"));
    }

    #[test]
    fn scene_document_validation_rejects_unsupported_asset_kind() {
        let mut scene = scene_document_from_script_builder(&sample_builder());
        scene.magnetization_assets[0].kind = "procedural".to_string();
        let error = scene_document_to_script_builder(&scene)
            .expect_err("unsupported magnetization kind must fail");
        assert!(error
            .message
            .contains("unsupported magnetization asset kind"));
    }

    #[test]
    fn scene_problem_projection_uses_scene_revision() {
        let scene = scene_document_from_script_builder(&sample_builder());
        let projection =
            scene_document_problem_projection(&scene).expect("problem projection should build");
        assert_eq!(projection.builder.revision, scene.revision);
        assert_eq!(
            projection
                .rewrite_overrides
                .get("geometries")
                .and_then(Value::as_array)
                .map(Vec::len),
            Some(1)
        );
    }
}
