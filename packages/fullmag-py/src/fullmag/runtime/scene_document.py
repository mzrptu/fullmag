from __future__ import annotations

from typing import Any


def _material_id(name: str) -> str:
    return f"mat:{name}"


def _magnetization_id(name: str) -> str:
    return f"mag:{name}"


def _zero_vec3() -> list[float]:
    return [0.0, 0.0, 0.0]


def _one_vec3() -> list[float]:
    return [1.0, 1.0, 1.0]


def _identity_quat() -> list[float]:
    return [0.0, 0.0, 0.0, 1.0]


def build_scene_document_from_builder(builder: dict[str, Any]) -> dict[str, Any]:
    geometries = builder.get("geometries") or []
    objects: list[dict[str, Any]] = []
    materials: list[dict[str, Any]] = []
    magnetization_assets: list[dict[str, Any]] = []

    for geometry in geometries:
        name = str(geometry.get("name", "object"))
        geometry_params = dict(geometry.get("geometry_params") or {})
        translation = geometry_params.pop("translation", geometry_params.pop("translate", [0, 0, 0]))
        magnetization = dict(geometry.get("magnetization") or {})
        mag_kind = str(magnetization.get("kind", "uniform"))
        if mag_kind == "file" and (
            magnetization.get("dataset") is not None or magnetization.get("sample_index") is not None
        ):
            mag_kind = "sampled"

        objects.append(
            {
                "id": name,
                "name": name,
                "geometry": {
                    "geometry_kind": str(geometry.get("geometry_kind", "")),
                    "geometry_params": geometry_params,
                    "bounds_min": geometry.get("bounds_min"),
                    "bounds_max": geometry.get("bounds_max"),
                },
                "transform": {
                    "translation": translation if isinstance(translation, list) else [0, 0, 0],
                    "rotation_quat": _identity_quat(),
                    "scale": _one_vec3(),
                    "pivot": _zero_vec3(),
                },
                "material_ref": _material_id(name),
                "region_name": geometry.get("region_name"),
                "magnetization_ref": _magnetization_id(name),
                "mesh_override": geometry.get("mesh"),
                "visible": True,
                "locked": False,
                "tags": [],
            }
        )
        materials.append(
            {
                "id": _material_id(name),
                "name": f"{name} material",
                "properties": geometry.get("material") or {},
            }
        )
        magnetization_assets.append(
            {
                "id": _magnetization_id(name),
                "name": f"{name} magnetization",
                "kind": mag_kind,
                "value": magnetization.get("value"),
                "seed": magnetization.get("seed"),
                "source_path": magnetization.get("source_path"),
                "source_format": magnetization.get("source_format"),
                "dataset": magnetization.get("dataset"),
                "sample_index": magnetization.get("sample_index"),
                "mapping": {
                    "space": "object",
                    "projection": "object_local",
                    "clamp_mode": "clamp",
                },
                "texture_transform": {
                    "translation": _zero_vec3(),
                    "rotation_quat": _identity_quat(),
                    "scale": _one_vec3(),
                    "pivot": _zero_vec3(),
                },
            }
        )

    return {
        "version": "scene.v1",
        "revision": int(builder.get("revision", 0)),
        "scene": {"id": "scene", "name": "Scene"},
        "universe": builder.get("universe"),
        "objects": objects,
        "materials": materials,
        "magnetization_assets": magnetization_assets,
        "current_modules": {
            "modules": builder.get("current_modules") or [],
            "excitation_analysis": builder.get("excitation_analysis"),
        },
        "study": {
            "backend": builder.get("backend"),
            "solver": builder.get("solver") or {},
            "mesh_defaults": builder.get("mesh") or {},
            "stages": builder.get("stages") or [],
            "initial_state": builder.get("initial_state"),
        },
        "outputs": {"items": []},
        "editor": {
            "selected_object_id": None,
            "gizmo_mode": None,
            "transform_space": None,
            "selected_entity_id": None,
            "focused_entity_id": None,
            "object_view_mode": "context",
            "air_mesh_visible": True,
            "air_mesh_opacity": 28.0,
            "mesh_entity_view_state": {},
        },
    }


def build_builder_from_scene_document(scene: dict[str, Any]) -> dict[str, Any]:
    materials = {
        str(material.get("id", "")): dict(material.get("properties") or {})
        for material in (scene.get("materials") or [])
    }
    magnetization_assets = {
        str(asset.get("id", "")): dict(asset)
        for asset in (scene.get("magnetization_assets") or [])
    }
    geometries: list[dict[str, Any]] = []

    for obj in scene.get("objects") or []:
        material_ref = str(obj.get("material_ref") or "")
        if not material_ref or material_ref not in materials:
            raise ValueError(
                f"object '{obj.get('id') or obj.get('name') or ''}' references missing material '{material_ref}'"
            )
        magnetization_ref = str(obj.get("magnetization_ref") or "")
        if not magnetization_ref or magnetization_ref not in magnetization_assets:
            raise ValueError(
                f"object '{obj.get('id') or obj.get('name') or ''}' references missing magnetization asset '{magnetization_ref}'"
            )
        geometry = dict(obj.get("geometry") or {})
        geometry_params = dict(geometry.get("geometry_params") or {})
        transform = dict(obj.get("transform") or {})
        translation = transform.get("translation")
        if isinstance(translation, list) and len(translation) == 3:
            if any(abs(float(value)) > 0 for value in translation):
                geometry_params["translation"] = [float(value) for value in translation]

        magnetization_asset = magnetization_assets[magnetization_ref]
        magnetization = {
            "kind": str(magnetization_asset.get("kind", "uniform")),
            "value": magnetization_asset.get("value"),
            "seed": magnetization_asset.get("seed"),
            "source_path": magnetization_asset.get("source_path"),
            "source_format": magnetization_asset.get("source_format"),
            "dataset": magnetization_asset.get("dataset"),
            "sample_index": magnetization_asset.get("sample_index"),
        }

        geometries.append(
            {
                "name": str(obj.get("name") or obj.get("id") or ""),
                "region_name": obj.get("region_name"),
                "geometry_kind": str(geometry.get("geometry_kind", "")),
                "geometry_params": geometry_params,
                "bounds_min": geometry.get("bounds_min"),
                "bounds_max": geometry.get("bounds_max"),
                "material": materials[material_ref],
                "magnetization": magnetization,
                "mesh": obj.get("mesh_override"),
            }
        )

    study = dict(scene.get("study") or {})
    current_modules = dict(scene.get("current_modules") or {})
    return {
        "revision": int(scene.get("revision", 0)),
        "backend": study.get("backend"),
        "solver": study.get("solver") or {},
        "mesh": study.get("mesh_defaults") or {},
        "universe": scene.get("universe"),
        "stages": study.get("stages") or [],
        "initial_state": study.get("initial_state"),
        "geometries": geometries,
        "current_modules": current_modules.get("modules") or [],
        "excitation_analysis": current_modules.get("excitation_analysis"),
    }


def builder_overrides_from_scene_document(scene: dict[str, Any]) -> dict[str, Any]:
    builder = build_builder_from_scene_document(scene)
    solver = dict(builder.get("solver") or {})
    mesh = dict(builder.get("mesh") or {})
    return {
        "solver": {
            "integrator": solver.get("integrator") or None,
            "fixed_timestep": _number_or_none(solver.get("fixed_timestep")),
            "relax": {
                "algorithm": solver.get("relax_algorithm") or None,
                "torque_tolerance": _number_or_none(solver.get("torque_tolerance")),
                "energy_tolerance": _number_or_none(solver.get("energy_tolerance")),
                "max_steps": _int_or_none(solver.get("max_relax_steps")),
            },
        },
        "mesh": {
            "algorithm_2d": mesh.get("algorithm_2d"),
            "algorithm_3d": mesh.get("algorithm_3d"),
            "hmax": _number_or_auto(mesh.get("hmax")),
            "hmin": _number_or_none(mesh.get("hmin")),
            "size_factor": mesh.get("size_factor"),
            "size_from_curvature": mesh.get("size_from_curvature"),
            "growth_rate": _number_or_none(mesh.get("growth_rate")),
            "narrow_regions": mesh.get("narrow_regions"),
            "smoothing_steps": mesh.get("smoothing_steps"),
            "optimize": mesh.get("optimize") or None,
            "optimize_iterations": mesh.get("optimize_iterations"),
            "compute_quality": mesh.get("compute_quality"),
            "per_element_quality": mesh.get("per_element_quality"),
            "adaptive_mesh": None
            if not mesh.get("adaptive_enabled")
            else {
                "enabled": True,
                "policy": mesh.get("adaptive_policy"),
                "theta": mesh.get("adaptive_theta"),
                "h_min": _number_or_none(mesh.get("adaptive_h_min")),
                "h_max": _number_or_none(mesh.get("adaptive_h_max")),
                "max_passes": mesh.get("adaptive_max_passes"),
                "error_tolerance": _number_or_none(mesh.get("adaptive_error_tolerance")),
            },
        },
        "universe": builder.get("universe"),
        "stages": [
            {
                "kind": stage.get("kind"),
                "entrypoint_kind": stage.get("entrypoint_kind"),
                "integrator": stage.get("integrator") or None,
                "fixed_timestep": _number_or_none(stage.get("fixed_timestep")),
                "until_seconds": _number_or_none(stage.get("until_seconds")),
                "relax_algorithm": stage.get("relax_algorithm") or None,
                "torque_tolerance": _number_or_none(stage.get("torque_tolerance")),
                "energy_tolerance": _number_or_none(stage.get("energy_tolerance")),
                "max_steps": _int_or_none(stage.get("max_steps")),
            }
            for stage in (builder.get("stages") or [])
        ],
        "initial_state": builder.get("initial_state"),
        "geometries": builder.get("geometries") or [],
        "current_modules": builder.get("current_modules") or [],
        "excitation_analysis": builder.get("excitation_analysis"),
    }


def _number_or_none(value: Any) -> float | str | None:
    if value is None:
        return None
    if isinstance(value, str):
        stripped = value.strip()
        if not stripped:
            return None
        if stripped.lower() == "auto":
            return "auto"
        try:
            return float(stripped)
        except ValueError:
            return None
    if isinstance(value, (int, float)):
        return float(value)
    return None


def _number_or_auto(value: Any) -> float | str | None:
    return _number_or_none(value)


def _int_or_none(value: Any) -> int | None:
    if value is None:
        return None
    if isinstance(value, str):
        stripped = value.strip()
        if not stripped:
            return None
        try:
            return int(stripped)
        except ValueError:
            return None
    if isinstance(value, (int, float)):
        return int(value)
    return None
