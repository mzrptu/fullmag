from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Sequence

from fullmag.init.magnetization import (
    RandomMagnetization,
    SampledMagnetization,
    UniformMagnetization,
)
from fullmag.init.state_io import infer_magnetization_state_format
from fullmag.model.antenna import (
    AntennaFieldSource,
    CPWAntenna,
    MicrostripAntenna,
    RfDrive,
    SpinWaveExcitationAnalysis,
)
from fullmag.model.discretization import FDM, FEM
from fullmag.model.dynamics import DEFAULT_GAMMA, LLG
from fullmag.model.energy import Demag, Exchange, InterfacialDMI, Pulse, Zeeman
from fullmag.model.geometry import (
    Box,
    Cylinder,
    Difference,
    Ellipse,
    Ellipsoid,
    ImportedGeometry,
    Intersection,
    Translate,
    Union,
)
from fullmag.model.outputs import (
    SaveDispersion,
    SaveField,
    SaveMode,
    SaveScalar,
    SaveSpectrum,
    Snapshot,
)
from fullmag.model.problem import Problem
from fullmag.model.study import Eigenmodes, Relaxation, TimeEvolution
from fullmag.runtime.loader import LoadedProblem, LoadedStage


def export_builder_draft(loaded: LoadedProblem) -> dict[str, object]:
    base_problem = loaded.stages[0].problem if loaded.stages else loaded.problem
    relax_stage = _first_relax_stage(loaded)
    runtime_metadata = _normalize_mapping(base_problem.runtime_metadata)
    mesh_workflow = _normalize_mapping(runtime_metadata.get("mesh_workflow"))
    mesh_options = _normalize_mapping(mesh_workflow.get("mesh_options"))
    fem = base_problem.discretization.fem if base_problem.discretization is not None else None

    return {
        "revision": 1,
        "solver": {
            "integrator": base_problem.study.dynamics.integrator,
            "fixed_timestep": _text_number(base_problem.study.dynamics.fixed_timestep),
            "relax_algorithm": relax_stage.algorithm if relax_stage is not None else "llg_overdamped",
            "torque_tolerance": _text_number(
                relax_stage.torque_tolerance if relax_stage is not None else 1e-6
            ),
            "energy_tolerance": _text_number(
                relax_stage.energy_tolerance if relax_stage is not None else None
            ),
            "max_relax_steps": str(relax_stage.max_steps if relax_stage is not None else 5000),
        },
        "mesh": {
            "algorithm_2d": int(mesh_options.get("algorithm_2d", 6)),
            "algorithm_3d": int(mesh_options.get("algorithm_3d", 1)),
            "hmax": _text_number(fem.hmax if isinstance(fem, FEM) else None),
            "hmin": _text_number(_number_or_none(mesh_options.get("hmin"))),
            "size_factor": float(mesh_options.get("size_factor", 1.0)),
            "size_from_curvature": int(mesh_options.get("size_from_curvature", 0)),
            "smoothing_steps": int(mesh_options.get("smoothing_steps", 1)),
            "optimize": str(mesh_options.get("optimize", "") or ""),
            "optimize_iterations": int(mesh_options.get("optimize_iterations", 1)),
            "compute_quality": bool(mesh_options.get("compute_quality", False)),
            "per_element_quality": bool(mesh_options.get("per_element_quality", False)),
        },
        "stages": [_export_stage_draft(stage) for stage in _builder_stage_sequence(loaded)],
        "initial_state": _export_initial_state(base_problem),
        "geometries": [_export_geometry_entry(magnet, base_problem) for magnet in base_problem.magnets],
        "current_modules": [
            _export_current_module_entry(module) for module in base_problem.current_modules
        ],
        "excitation_analysis": _export_excitation_analysis(base_problem),
    }


def rewrite_loaded_problem_script(
    loaded: LoadedProblem,
    *,
    overrides: dict[str, object] | None = None,
    write: bool = False,
) -> dict[str, object]:
    rendered = render_loaded_problem_as_flat_script(loaded, overrides=overrides)
    script_path = loaded.source_path

    if write:
        temp_path = script_path.with_name(f"{script_path.name}.fullmag.tmp")
        temp_path.write_text(rendered, encoding="utf-8")
        temp_path.replace(script_path)

    return {
        "script_path": str(script_path),
        "source_kind": _builder_source_kind(loaded.entrypoint_kind),
        "entrypoint_kind": loaded.entrypoint_kind,
        "written": write,
        "bytes_written": len(rendered.encode("utf-8")) if write else 0,
        **({"rendered_source": rendered} if not write else {}),
    }


def render_loaded_problem_as_flat_script(
    loaded: LoadedProblem,
    *,
    overrides: dict[str, object] | None = None,
) -> str:
    overrides = _normalize_mapping(overrides)
    actual_stages = loaded.stages
    _validate_stage_compatibility(actual_stages)
    stages = actual_stages or (
        ()
        if loaded.entrypoint_kind == "flat_workspace"
        else (
            LoadedStage(
                problem=loaded.problem,
                entrypoint_kind=loaded.entrypoint_kind,
                default_until_seconds=loaded.default_until_seconds,
            ),
        )
    )

    base_problem = stages[0].problem if stages else loaded.problem
    magnet_vars = _magnet_variable_names(base_problem, overrides=overrides)
    lines: list[str] = []
    source_root = loaded.source_path.parent

    lines.extend(_render_header(loaded.source_path, loaded.entrypoint_kind))
    lines.append("")
    lines.append("import fullmag as fm")
    lines.append("")

    lines.extend(_render_runtime(base_problem, overrides=overrides))
    lines.append("")
    _validate_energy_terms(base_problem)
    lines.extend(
        _render_geometry_and_materials(
            base_problem,
            magnet_vars,
            source_root=source_root,
            overrides=overrides,
        )
    )

    external_field_lines = _render_external_field(base_problem)
    if external_field_lines:
        lines.append("")
        lines.extend(external_field_lines)

    current_module_lines = _render_current_modules(base_problem, overrides=overrides)
    if current_module_lines:
        lines.append("")
        lines.extend(current_module_lines)

    mesh_lines = _render_mesh_workflow(
        base_problem,
        magnet_vars,
        source_root=source_root,
        overrides=overrides,
    )
    if mesh_lines:
        lines.append("")
        lines.extend(mesh_lines)

    lines.append("")
    lines.extend(_render_solver(base_problem, overrides=overrides))

    output_lines = _render_outputs(base_problem, magnet_vars)
    if output_lines:
        lines.append("")
        lines.extend(output_lines)

    excitation_lines = _render_excitation_analysis(base_problem, overrides=overrides)
    if excitation_lines:
        lines.append("")
        lines.extend(excitation_lines)

    stage_lines = _render_stages(stages, overrides=overrides)
    if stage_lines:
        lines.append("")
        lines.extend(stage_lines)

    normalized = "\n".join(lines).rstrip() + "\n"
    return normalized


def _first_relax_stage(loaded: LoadedProblem) -> Relaxation | None:
    for stage in loaded.stages:
        if isinstance(stage.problem.study, Relaxation):
            return stage.problem.study
    if isinstance(loaded.problem.study, Relaxation):
        return loaded.problem.study
    return None


def _builder_stage_sequence(loaded: LoadedProblem) -> tuple[LoadedStage, ...]:
    if loaded.stages:
        return loaded.stages
    if loaded.entrypoint_kind == "flat_workspace":
        return ()
    return (
        LoadedStage(
            problem=loaded.problem,
            entrypoint_kind=loaded.entrypoint_kind,
            default_until_seconds=loaded.default_until_seconds,
        ),
    )


def _export_stage_draft(stage: LoadedStage) -> dict[str, object]:
    study = stage.problem.study
    dynamics = study.dynamics
    if isinstance(study, Relaxation):
        return {
            "kind": "relax",
            "entrypoint_kind": stage.entrypoint_kind,
            "integrator": dynamics.integrator,
            "fixed_timestep": _text_number(dynamics.fixed_timestep),
            "until_seconds": "",
            "relax_algorithm": study.algorithm,
            "torque_tolerance": _text_number(study.torque_tolerance),
            "energy_tolerance": _text_number(study.energy_tolerance),
            "max_steps": str(study.max_steps),
        }
    if isinstance(study, Eigenmodes):
        return {
            "kind": "eigenmodes",
            "entrypoint_kind": stage.entrypoint_kind,
            "integrator": dynamics.integrator,
            "fixed_timestep": _text_number(dynamics.fixed_timestep),
            "until_seconds": "",
            "relax_algorithm": "",
            "torque_tolerance": "",
            "energy_tolerance": "",
            "max_steps": "",
        }
    return {
        "kind": "run",
        "entrypoint_kind": stage.entrypoint_kind,
        "integrator": dynamics.integrator,
        "fixed_timestep": _text_number(dynamics.fixed_timestep),
        "until_seconds": _text_number(stage.default_until_seconds),
        "relax_algorithm": "",
        "torque_tolerance": "",
        "energy_tolerance": "",
        "max_steps": "",
    }


def _render_header(script_path: Path, entrypoint_kind: str) -> list[str]:
    return [
        '"""Canonical Fullmag script generated from the model builder.',
        "",
        f"Source: {script_path.name}",
        f"Entrypoint: {entrypoint_kind}",
        '"""',
    ]


def _render_runtime(
    problem: Problem,
    *,
    overrides: dict[str, object],
) -> list[str]:
    runtime = problem.runtime
    lines = ["# Engine"]
    if problem.name != "fullmag_sim":
        lines.append(f"fm.name({_py_repr(problem.name)})")
    lines.append(f"fm.engine({_py_repr(runtime.backend_target.value)})")

    device_spec = _runtime_device_spec(runtime)
    if device_spec == "auto" and runtime.execution_precision.value == "double":
        pass
    elif runtime.execution_precision.value == "double":
        if device_spec == "cpu":
            lines.append("fm.device(\"cpu\", precision=\"double\")")
        else:
            lines.append(f"fm.device({_py_repr(device_spec)}, precision=\"double\")")
    elif runtime.execution_precision.value == "single":
        lines.append(f"fm.device({_py_repr(device_spec)}, precision=\"single\")")
    else:
        lines.append(f"fm.device({_py_repr(device_spec)})")

    fdm = problem.discretization.fdm if problem.discretization is not None else None
    if isinstance(fdm, FDM) and fdm.default_cell is not None:
        lines.append(f"fm.cell({_py_number(fdm.default_cell[0])}, {_py_number(fdm.default_cell[1])}, {_py_number(fdm.default_cell[2])})")
        if fdm.boundary_correction is not None:
            lines.append(f"fm.boundary_correction({_py_repr(fdm.boundary_correction)})")

    runtime_metadata = _normalize_mapping(problem.runtime_metadata)
    if runtime_metadata.get("interactive_session_requested") is True:
        lines.append("fm.interactive(True)")
    if runtime_metadata.get("wait_for_solve") is True:
        lines.append("fm.wait_for_solve(True)")
    adaptive_mesh = _normalize_mapping(runtime_metadata.get("adaptive_mesh"))
    if adaptive_mesh:
        kwargs: list[str] = []
        if adaptive_mesh.get("policy") is not None:
            kwargs.append(f"policy={_py_repr(str(adaptive_mesh.get('policy')))}")
        if adaptive_mesh.get("theta") is not None:
            kwargs.append(f"theta={_py_number(float(adaptive_mesh.get('theta')))}")
        if adaptive_mesh.get("h_min") is not None:
            kwargs.append(f"h_min={_py_number(float(adaptive_mesh.get('h_min')))}")
        if adaptive_mesh.get("h_max") is not None:
            kwargs.append(f"h_max={_py_number(float(adaptive_mesh.get('h_max')))}")
        if adaptive_mesh.get("max_passes") is not None:
            kwargs.append(f"max_passes={int(adaptive_mesh.get('max_passes'))}")
        if adaptive_mesh.get("error_tolerance") is not None:
            kwargs.append(
                f"error_tolerance={_py_number(float(adaptive_mesh.get('error_tolerance')))}"
            )
        if adaptive_mesh.get("chunk_until_seconds") is not None:
            kwargs.append(
                f"chunk_until_seconds={_py_number(float(adaptive_mesh.get('chunk_until_seconds')))}"
            )
        if adaptive_mesh.get("steps_per_pass") is not None:
            kwargs.append(f"steps_per_pass={int(adaptive_mesh.get('steps_per_pass'))}")
        enabled = bool(adaptive_mesh.get("enabled", True))
        if kwargs:
            lines.append(f"fm.adaptive_mesh({str(enabled)}, {', '.join(kwargs)})")
        elif enabled is not True:
            lines.append(f"fm.adaptive_mesh({str(enabled)})")
    return lines


def _render_geometry_and_materials(
    problem: Problem,
    magnet_vars: dict[str, str],
    *,
    source_root: Path,
    overrides: dict[str, object],
) -> list[str]:
    geometries_override = overrides.get("geometries")
    if isinstance(geometries_override, list):
        return _render_geometries_from_override(
            geometries_override,
            magnet_vars=magnet_vars,
            source_root=source_root,
            overrides=overrides,
        )

    initial_state_override = _normalize_mapping(overrides.get("initial_state"))
    lines = ["# Geometry & Material"]
    for magnet in problem.magnets:
        var_name = magnet_vars[magnet.name]
        lines.append(
            f"{var_name} = fm.geometry({_render_geometry_expr(magnet.geometry, magnet_name=magnet.name, source_root=source_root)}, name={_py_repr(magnet.name)})"
        )
        lines.append(f"{var_name}.Ms = {_py_number(magnet.material.Ms)}")
        lines.append(f"{var_name}.Aex = {_py_number(magnet.material.A)}")
        lines.append(f"{var_name}.alpha = {_py_number(magnet.material.alpha)}")
        if magnet.material.Ku1 is not None:
            raise ValueError(
                "canonical flat-script rewrite does not yet support Ku1 material terms"
            )
        if magnet.material.anisU is not None:
            raise ValueError(
                "canonical flat-script rewrite does not yet support anisotropy axis terms"
            )
        rendered_initial_override = _render_initial_state_override(
            initial_state_override,
            magnet_name=magnet.name,
            magnet_var=var_name,
            source_root=source_root,
        )
        if rendered_initial_override is not None:
            lines.extend(rendered_initial_override)
        elif magnet.m0 is not None:
            rendered_initial = _render_initial_magnetization(
                magnet.m0,
                magnet_var=var_name,
                source_root=source_root,
            )
            if isinstance(rendered_initial, list):
                lines.extend(rendered_initial)
            else:
                lines.append(rendered_initial)
        dmi = _magnet_dmi(problem, magnet.name)
        if dmi is not None:
            lines.append(f"{var_name}.Dind = {_py_number(dmi)}")
        lines.append("")
    if lines[-1] == "":
        lines.pop()
    return lines


def _render_geometries_from_override(
    geometries: list[object],
    *,
    magnet_vars: dict[str, str],
    source_root: Path,
    overrides: dict[str, object],
) -> list[str]:
    initial_state_override = _normalize_mapping(overrides.get("initial_state"))
    lines = ["# Geometry & Material"]
    for geo_obj in geometries:
        g = _normalize_mapping(geo_obj)
        name = str(g.get("name", ""))
        var_name = magnet_vars.get(name, "body")

        kind = str(g.get("geometry_kind", "Box"))
        params = _normalize_mapping(g.get("geometry_params"))

        args = []
        if kind == "Box":
            size = params.get("size")
            if isinstance(size, list) and len(size) == 3:
                args = [f"{_py_number(float(size[0]))}", f"{_py_number(float(size[1]))}", f"{_py_number(float(size[2]))}"]
            elif isinstance(size, (int, float)):
                args = [f"{_py_number(float(size))}"] * 3
            else:
                args = ["1e-9", "1e-9", "1e-9"]
            expr = f"fm.Box({', '.join(args)}, name={_py_repr(name)})"
        elif kind == "Cylinder":
            expr = f"fm.Cylinder(radius={_py_number(float(str(params.get('radius', 1e-9))))}, height={_py_number(float(str(params.get('height', 1e-9))))}, name={_py_repr(name)})"
        elif kind == "Ellipsoid":
            expr = f"fm.Ellipsoid({_py_number(float(str(params.get('rx', 1e-9))))}, {_py_number(float(str(params.get('ry', 1e-9))))}, {_py_number(float(str(params.get('rz', 1e-9))))}, name={_py_repr(name)})"
        elif kind == "ImportedGeometry":
            source = str(params.get("source", ""))
            expr = f"fm.ImportedGeometry(source={_py_repr(_relativize_path(source, source_root))}, name={_py_repr(name)})"
        else:
            expr = f"fm.Box(1e-9, 1e-9, 1e-9, name={_py_repr(name)})"

        t = params.get("translation")
        if isinstance(t, list) and len(t) == 3 and any(float(v) != 0 for v in t):
            expr = f"{expr}.translate(({_py_number(float(t[0]))}, {_py_number(float(t[1]))}, {_py_number(float(t[2]))}))"

        lines.append(f"{var_name} = fm.geometry({expr}, name={_py_repr(name)})")

        mat = _normalize_mapping(g.get("material"))
        lines.append(f"{var_name}.Ms = {_py_number(float(str(mat.get('Ms', 800000))))}")
        lines.append(f"{var_name}.Aex = {_py_number(float(str(mat.get('Aex', 1.3e-11))))}")
        lines.append(f"{var_name}.alpha = {_py_number(float(str(mat.get('alpha', 0.02))))}")
        if mat.get("Dind") is not None:
            lines.append(f"{var_name}.Dind = {_py_number(float(str(mat.get('Dind'))))}")

        rendered_initial_override = _render_initial_state_override(
            initial_state_override,
            magnet_name=name,
            magnet_var=var_name,
            source_root=source_root,
        )
        if rendered_initial_override is not None:
            lines.extend(rendered_initial_override)
        else:
            mag = _normalize_mapping(g.get("magnetization"))
            mag_kind = str(mag.get("kind", "uniform"))
            if mag_kind == "uniform":
                val = mag.get("value")
                if isinstance(val, list) and len(val) == 3:
                    lines.append(f"{var_name}.m = fm.uniform({_py_number(float(val[0]))}, {_py_number(float(val[1]))}, {_py_number(float(val[2]))})")
            elif mag_kind == "random":
                seed = mag.get("seed")
                if seed is not None:
                    lines.append(f"{var_name}.m = fm.random(seed={int(str(seed))})")
                else:
                    lines.append(f"{var_name}.m = fm.random()")
            elif mag_kind == "vortex":
                lines.append(f"{var_name}.m = fm.vortex(core_radius=10e-9)")
            elif mag_kind == "file":
                src = str(mag.get("source_path", ""))
                if src:
                    kwargs = []
                    if mag.get("dataset"): kwargs.append(f"dataset={_py_repr(mag.get('dataset'))}")
                    if mag.get("sample_index"): kwargs.append(f"sample={int(str(mag.get('sample_index')))}")
                    lines.append(f"{var_name}.m = fm.sampled({_py_repr(_relativize_path(src, source_root))}{', ' + ', '.join(kwargs) if kwargs else ''})")
        
        lines.append("")

    if lines and lines[-1] == "":
        lines.pop()
    return lines


def _render_external_field(problem: Problem) -> list[str]:
    for term in problem.energy:
        if isinstance(term, Zeeman):
            return [
                "# External field",
                f"fm.b_ext({_py_number(term.B[0])}, {_py_number(term.B[1])}, {_py_number(term.B[2])})",
            ]
    return []


def _render_current_modules(
    problem: Problem,
    *,
    overrides: dict[str, object],
) -> list[str]:
    override_modules = overrides.get("current_modules")
    if isinstance(override_modules, list):
        modules = override_modules
    else:
        modules = list(problem.current_modules)
    if not modules:
        return []
    lines = ["# Antennas"]
    for module in modules:
        if isinstance(module, AntennaFieldSource):
            kwargs = [
                f"name={_py_repr(module.name)}",
                f"antenna={_render_antenna_expr(module.antenna)}",
                f"drive={_render_drive_expr(module.drive)}",
            ]
            if module.solver != "mqs_2p5d_az":
                kwargs.append(f"solver={_py_repr(module.solver)}")
            if abs(module.air_box_factor - 12.0) > 1e-12:
                kwargs.append(f"air_box_factor={_py_number(module.air_box_factor)}")
            lines.append(f"fm.antenna_field_source({', '.join(kwargs)})")
            continue
        if isinstance(module, dict):
            lines.append(_render_current_module_override(module))
            continue
        raise ValueError(
            f"canonical flat-script rewrite does not yet support current module {type(module).__name__}"
        )
    return lines


def _render_excitation_analysis(
    problem: Problem,
    *,
    overrides: dict[str, object],
) -> list[str]:
    analysis_override = overrides.get("excitation_analysis")
    analysis = analysis_override if isinstance(analysis_override, dict) else problem.excitation_analysis
    if analysis is None:
        return []
    if not isinstance(analysis, SpinWaveExcitationAnalysis):
        if isinstance(analysis, dict):
            return ["# Excitation analysis", _render_excitation_analysis_override(analysis)]
        raise ValueError(
            "canonical flat-script rewrite does not yet support non-antenna excitation analyses"
        )
    kwargs = [
        f"source={_py_repr(analysis.source)}",
        f"method={_py_repr(analysis.method)}",
        f"propagation_axis={_py_literal(list(analysis.propagation_axis))}",
        f"samples={analysis.samples}",
    ]
    if analysis.k_max_rad_per_m is not None:
        kwargs.append(f"k_max_rad_per_m={_py_number(analysis.k_max_rad_per_m)}")
    return ["# Excitation analysis", f"fm.spin_wave_excitation({', '.join(kwargs)})"]


def _render_mesh_workflow(
    problem: Problem,
    magnet_vars: dict[str, str],
    *,
    source_root: Path,
    overrides: dict[str, object],
) -> list[str]:
    runtime_metadata = _normalize_mapping(problem.runtime_metadata)
    mesh_workflow = _normalize_mapping(runtime_metadata.get("mesh_workflow"))
    fem = problem.discretization.fem if problem.discretization is not None else None
    if not isinstance(fem, FEM) and not mesh_workflow:
        return []

    mesh_override = _normalize_mapping(overrides.get("mesh"))
    target_var = magnet_vars[problem.magnets[0].name]
    kwargs: list[str] = []

    hmax_value = _override_number(mesh_override, "hmax", fem.hmax if isinstance(fem, FEM) else None)
    if hmax_value is not None:
        kwargs.append(f"hmax={_py_number(hmax_value)}")
    hmin_value = _override_number(mesh_override, "hmin", None)
    if hmin_value is not None:
        kwargs.append(f"hmin={_py_number(hmin_value)}")
    order_value = _override_int(mesh_override, "order", fem.order if isinstance(fem, FEM) else 1)
    if order_value is not None:
        kwargs.append(f"order={order_value}")
    source_value = _override_string(
        mesh_override,
        "source",
        fem.mesh if isinstance(fem, FEM) and fem.mesh else None,
    )
    if source_value:
        kwargs.append(f"source={_py_repr(_relativize_path(source_value, source_root))}")

    for key, source_name in (
        ("algorithm_2d", "algorithm_2d"),
        ("algorithm_3d", "algorithm_3d"),
        ("size_factor", "size_factor"),
        ("size_from_curvature", "size_from_curvature"),
        ("smoothing_steps", "smoothing_steps"),
        ("optimize_iterations", "optimize_iterations"),
    ):
        if key in mesh_override and mesh_override[key] is not None:
            kwargs.append(f"{source_name}={_py_literal(mesh_override[key])}")

    if "optimize" in mesh_override and mesh_override["optimize"] is not None:
        kwargs.append(f"optimize={_py_repr(str(mesh_override['optimize']))}")
    if "compute_quality" in mesh_override and mesh_override["compute_quality"] is not None:
        kwargs.append(f"compute_quality={_py_literal(bool(mesh_override['compute_quality']))}")
    if "per_element_quality" in mesh_override and mesh_override["per_element_quality"] is not None:
        kwargs.append(f"per_element_quality={_py_literal(bool(mesh_override['per_element_quality']))}")

    if not mesh_override and mesh_workflow:
        fem_info = _normalize_mapping(mesh_workflow.get("fem"))
        if fem_info:
            if "hmax" not in {entry.split("=", 1)[0] for entry in kwargs} and fem_info.get("hmax") is not None:
                kwargs.append(f"hmax={_py_number(float(fem_info['hmax']))}")
            if "order" not in {entry.split("=", 1)[0] for entry in kwargs} and fem_info.get("order") is not None:
                kwargs.append(f"order={int(fem_info['order'])}")
            mesh_source = fem_info.get("mesh")
            if mesh_source:
                kwargs.append(f"source={_py_repr(_relativize_path(str(mesh_source), source_root))}")
        mesh_options = _normalize_mapping(mesh_workflow.get("mesh_options"))
        if mesh_options:
            for src, dst in (
                ("algorithm_2d", "algorithm_2d"),
                ("algorithm_3d", "algorithm_3d"),
                ("hmin", "hmin"),
                ("size_factor", "size_factor"),
                ("size_from_curvature", "size_from_curvature"),
                ("smoothing_steps", "smoothing_steps"),
                ("optimize", "optimize"),
                ("optimize_iterations", "optimize_iterations"),
                ("compute_quality", "compute_quality"),
                ("per_element_quality", "per_element_quality"),
            ):
                value = mesh_options.get(src)
                if value is None:
                    continue
                if dst in {"optimize", "source"}:
                    kwargs.append(f"{dst}={_py_repr(str(value))}")
                else:
                    kwargs.append(f"{dst}={_py_literal(value)}")

    seen: set[str] = set()
    deduped_kwargs: list[str] = []
    for entry in kwargs:
        name = entry.split("=", 1)[0]
        if name in seen:
            continue
        seen.add(name)
        deduped_kwargs.append(entry)

    lines = ["# Mesh"]
    if deduped_kwargs:
        lines.append(f"{target_var}.mesh({', '.join(deduped_kwargs)})")
    else:
        lines.append(f"{target_var}.mesh(hmax={_py_number(fem.hmax if isinstance(fem, FEM) else 5e-9)}, order={fem.order if isinstance(fem, FEM) else 1})")

    if mesh_workflow:
        mesh_options = _normalize_mapping(mesh_workflow.get("mesh_options"))
        size_fields = mesh_options.get("size_fields") if mesh_options is not None else None
        if isinstance(size_fields, list):
            for field in size_fields:
                field_map = _normalize_mapping(field)
                kind = field_map.get("kind")
                params = _normalize_mapping(field_map.get("params"))
                if not isinstance(kind, str) or not params:
                    continue
                rendered_params = ", ".join(
                    f"{key}={_py_literal(value)}" for key, value in sorted(params.items())
                )
                lines.append(f"{target_var}.mesh.size_field({_py_repr(kind)}, {rendered_params})")

    build_requested = True
    if mesh_workflow:
        build_requested = bool(mesh_workflow.get("build_requested", True))
    if build_requested:
        lines.append(f"{target_var}.mesh.build()")
    return lines


def _render_solver(
    problem: Problem,
    *,
    overrides: dict[str, object],
) -> list[str]:
    solver_override = _normalize_mapping(overrides.get("solver"))
    dynamics = problem.study.dynamics
    return ["# Solver", _render_solver_call(dynamics, solver_override)]


def _render_outputs(problem: Problem, magnet_vars: dict[str, str]) -> list[str]:
    outputs = _study_outputs(problem.study)
    if not outputs:
        return []
    lines = ["# Outputs"]
    for output in outputs:
        if isinstance(output, SaveField):
            lines.append(f"fm.save({_py_repr(output.field)}, every={_py_number(output.every)})")
            continue
        if isinstance(output, SaveScalar):
            lines.append(f"fm.save({_py_repr(output.scalar)}, every={_py_number(output.every)})")
            continue
        if isinstance(output, Snapshot):
            quantity = _snapshot_quantity_string(output)
            if output.layer is not None and output.layer in magnet_vars:
                lines.append(
                    f"fm.snapshot({magnet_vars[output.layer]}, {_py_repr(quantity)}, every={_py_number(output.every)})"
                )
            else:
                lines.append(f"fm.snapshot({_py_repr(quantity)}, every={_py_number(output.every)})")
            continue
        if isinstance(output, (SaveSpectrum, SaveMode, SaveDispersion)):
            raise ValueError(
                "canonical flat-script rewrite does not yet support Eigenmodes outputs; "
                "keep these studies in build()/Problem scripts for now"
            )
        raise ValueError(f"unsupported output type: {type(output).__name__}")
    return lines


def _render_stages(
    stages: Sequence[LoadedStage],
    *,
    overrides: dict[str, object],
) -> list[str]:
    if not stages:
        return []
    solver_override = _normalize_mapping(overrides.get("solver"))
    stage_overrides = overrides.get("stages")
    lines = ["# Run"]
    previous_dynamics_signature: dict[str, object] | None = None
    for index, stage in enumerate(stages):
        dynamics_signature = stage.problem.study.dynamics.to_ir()
        if previous_dynamics_signature is not None and dynamics_signature != previous_dynamics_signature:
            lines.append(_render_solver_call(stage.problem.study.dynamics, solver_override))
        previous_dynamics_signature = dynamics_signature

        study = stage.problem.study
        stage_override = _stage_override_for(stage_overrides, index=index, stage=stage)
        if isinstance(study, Eigenmodes):
            raise ValueError(
                "canonical flat-script rewrite does not yet support Eigenmodes studies; "
                "keep them in build()/Problem scripts for now"
            )
        if isinstance(study, Relaxation):
            relax_override = _normalize_mapping(solver_override.get("relax"))
            algorithm = (
                _override_string(stage_override, "relax_algorithm", None)
                or _override_string(relax_override, "algorithm", study.algorithm)
                or study.algorithm
            )
            torque_tolerance = _override_number(
                stage_override,
                "torque_tolerance",
                _override_number(
                    relax_override,
                    "torque_tolerance",
                    study.torque_tolerance,
                ),
            )
            energy_tolerance = _override_number(
                stage_override,
                "energy_tolerance",
                _override_number(
                    relax_override,
                    "energy_tolerance",
                    study.energy_tolerance,
                ),
            )
            max_steps = _override_int(
                stage_override,
                "max_steps",
                _override_int(relax_override, "max_steps", study.max_steps),
            )
            call_parts = [
                f"tol={_py_number(torque_tolerance)}",
                f"max_steps={max_steps}",
                f"algorithm={_py_repr(algorithm)}",
            ]
            if energy_tolerance is not None:
                call_parts.append(f"energy_tolerance={_py_number(energy_tolerance)}")
            lines.append(f"fm.relax({', '.join(call_parts)})")
            continue

        until_seconds = _override_number(
            stage_override,
            "until_seconds",
            stage.default_until_seconds,
        )
        if until_seconds is None:
            raise ValueError(
                "canonical rewrite requires DEFAULT_UNTIL for time-evolution scripts"
            )
        lines.append(f"fm.run({_py_number(until_seconds)})")
    return lines


def _stage_override_for(
    raw_stage_overrides: object,
    *,
    index: int,
    stage: LoadedStage,
) -> dict[str, object]:
    if not isinstance(raw_stage_overrides, list):
        return {}
    if index >= len(raw_stage_overrides):
        return {}
    override = _normalize_mapping(raw_stage_overrides[index])
    if not override:
        return {}
    expected_kind = "relax" if isinstance(stage.problem.study, Relaxation) else "run"
    override_kind = override.get("kind")
    if isinstance(override_kind, str) and override_kind and override_kind != expected_kind:
        return {}
    return override


def _render_solver_call(dynamics: LLG, solver_override: dict[str, object]) -> str:
    kwargs: list[str] = []
    integrator = _override_string(solver_override, "integrator", dynamics.integrator)
    if integrator and integrator != "auto":
        kwargs.append(f"integrator={_py_repr(integrator)}")

    fixed_timestep = _override_number(solver_override, "fixed_timestep", dynamics.fixed_timestep)
    if dynamics.adaptive_timestep is not None:
        if fixed_timestep is not None:
            kwargs.append(f"dt={_py_number(fixed_timestep)}")
        kwargs.append(f"max_error={_py_number(dynamics.adaptive_timestep.atol)}")
    elif fixed_timestep is not None:
        kwargs.append(f"dt={_py_number(fixed_timestep)}")

    if dynamics.gamma is not None and abs(dynamics.gamma - DEFAULT_GAMMA) > 1e-12:
        kwargs.append(f"gamma={_py_number(dynamics.gamma)}")

    if not kwargs:
        return "fm.solver()"
    return f"fm.solver({', '.join(kwargs)})"


def _render_drive_expr(drive: RfDrive) -> str:
    kwargs = [f"current_a={_py_number(drive.current_a)}"]
    if drive.waveform is not None:
        kwargs.append(f"waveform={_render_time_dependence_expr(drive.waveform)}")
    elif drive.frequency_hz is not None:
        kwargs.append(f"frequency_hz={_py_number(drive.frequency_hz)}")
        if abs(drive.phase_rad) > 1e-15:
            kwargs.append(f"phase_rad={_py_number(drive.phase_rad)}")
    return f"fm.RfDrive({', '.join(kwargs)})"


def _render_time_dependence_expr(waveform: object) -> str:
    if isinstance(waveform, Sinusoidal):
        kwargs = [f"frequency_hz={_py_number(waveform.frequency_hz)}"]
        if abs(waveform.phase_rad) > 1e-15:
            kwargs.append(f"phase_rad={_py_number(waveform.phase_rad)}")
        if abs(waveform.offset) > 1e-15:
            kwargs.append(f"offset={_py_number(waveform.offset)}")
        return f"fm.Sinusoidal({', '.join(kwargs)})"
    if isinstance(waveform, Pulse):
        return (
            f"fm.Pulse(t_on={_py_number(waveform.t_on)}, "
            f"t_off={_py_number(waveform.t_off)})"
        )
    return f"fm.{type(waveform).__name__}()"


def _render_antenna_expr(antenna: object) -> str:
    if isinstance(antenna, MicrostripAntenna):
        return (
            "fm.MicrostripAntenna("
            f"width={_py_number(antenna.width)}, "
            f"thickness={_py_number(antenna.thickness)}, "
            f"height_above_magnet={_py_number(antenna.height_above_magnet)}, "
            f"preview_length={_py_number(antenna.preview_length)}, "
            f"center_x={_py_number(antenna.center_x)}, "
            f"center_y={_py_number(antenna.center_y)})"
        )
    if isinstance(antenna, CPWAntenna):
        return (
            "fm.CPWAntenna("
            f"signal_width={_py_number(antenna.signal_width)}, "
            f"gap={_py_number(antenna.gap)}, "
            f"ground_width={_py_number(antenna.ground_width)}, "
            f"thickness={_py_number(antenna.thickness)}, "
            f"height_above_magnet={_py_number(antenna.height_above_magnet)}, "
            f"preview_length={_py_number(antenna.preview_length)}, "
            f"center_x={_py_number(antenna.center_x)}, "
            f"center_y={_py_number(antenna.center_y)})"
        )
    raise ValueError(
        f"canonical flat-script rewrite does not yet support antenna kind {type(antenna).__name__}"
    )


def _render_current_module_override(module: dict[str, object]) -> str:
    antenna_kind = str(module.get("antenna_kind") or "")
    antenna_params = _normalize_mapping(module.get("antenna_params"))
    drive = _normalize_mapping(module.get("drive"))
    kwargs = [
        f"name={_py_repr(str(module.get('name') or 'antenna'))}",
        f"antenna={_render_antenna_override(antenna_kind, antenna_params)}",
        f"drive={_render_drive_override(drive)}",
    ]
    solver = str(module.get("solver") or "mqs_2p5d_az")
    if solver != "mqs_2p5d_az":
        kwargs.append(f"solver={_py_repr(solver)}")
    air_box_factor = module.get("air_box_factor")
    if air_box_factor is not None and abs(float(air_box_factor) - 12.0) > 1e-12:
        kwargs.append(f"air_box_factor={_py_number(float(air_box_factor))}")
    return f"fm.antenna_field_source({', '.join(kwargs)})"


def _render_antenna_override(kind: str, params: dict[str, object]) -> str:
    if kind == "MicrostripAntenna":
        return (
            "fm.MicrostripAntenna("
            f"width={_py_number(float(params.get('width', 1.0)))}, "
            f"thickness={_py_number(float(params.get('thickness', 1.0)))}, "
            f"height_above_magnet={_py_number(float(params.get('height_above_magnet', 0.0)))}, "
            f"preview_length={_py_number(float(params.get('preview_length', 1.0)))}, "
            f"center_x={_py_number(float(params.get('center_x', 0.0)))}, "
            f"center_y={_py_number(float(params.get('center_y', 0.0)))})"
        )
    if kind == "CPWAntenna":
        return (
            "fm.CPWAntenna("
            f"signal_width={_py_number(float(params.get('signal_width', 1.0)))}, "
            f"gap={_py_number(float(params.get('gap', 1.0)))}, "
            f"ground_width={_py_number(float(params.get('ground_width', 1.0)))}, "
            f"thickness={_py_number(float(params.get('thickness', 1.0)))}, "
            f"height_above_magnet={_py_number(float(params.get('height_above_magnet', 0.0)))}, "
            f"preview_length={_py_number(float(params.get('preview_length', 1.0)))}, "
            f"center_x={_py_number(float(params.get('center_x', 0.0)))}, "
            f"center_y={_py_number(float(params.get('center_y', 0.0)))})"
        )
    raise ValueError(f"unsupported antenna override kind: {kind}")


def _render_drive_override(drive: dict[str, object]) -> str:
    kwargs = [f"current_a={_py_number(float(drive.get('current_a', 0.0)))}"]
    frequency_hz = drive.get("frequency_hz")
    if frequency_hz is not None:
        kwargs.append(f"frequency_hz={_py_number(float(frequency_hz))}")
    phase_rad = drive.get("phase_rad")
    if phase_rad is not None and abs(float(phase_rad)) > 1e-15:
        kwargs.append(f"phase_rad={_py_number(float(phase_rad))}")
    waveform = drive.get("waveform")
    if isinstance(waveform, dict):
        kwargs.append(f"waveform={_render_waveform_override(waveform)}")
    return f"fm.RfDrive({', '.join(kwargs)})"


def _render_waveform_override(waveform: dict[str, object]) -> str:
    kind = str(waveform.get("kind") or "")
    if kind == "sinusoidal":
        kwargs = [f"frequency_hz={_py_number(float(waveform.get('frequency_hz', 0.0)))}"]
        if abs(float(waveform.get("phase_rad", 0.0))) > 1e-15:
            kwargs.append(f"phase_rad={_py_number(float(waveform.get('phase_rad', 0.0)))}")
        if abs(float(waveform.get("offset", 0.0))) > 1e-15:
            kwargs.append(f"offset={_py_number(float(waveform.get('offset', 0.0)))}")
        return f"fm.Sinusoidal({', '.join(kwargs)})"
    if kind == "pulse":
        return (
            f"fm.Pulse(t_on={_py_number(float(waveform.get('t_on', 0.0)))}, "
            f"t_off={_py_number(float(waveform.get('t_off', 0.0)))})"
        )
    raise ValueError(f"unsupported waveform override kind: {kind}")


def _render_excitation_analysis_override(analysis: dict[str, object]) -> str:
    axis = analysis.get("propagation_axis")
    propagation_axis = axis if isinstance(axis, list) and len(axis) == 3 else [1.0, 0.0, 0.0]
    kwargs = [
        f"source={_py_repr(str(analysis.get('source') or 'antenna'))}",
        f"method={_py_repr(str(analysis.get('method') or 'source_k_profile'))}",
        f"propagation_axis={_py_literal(propagation_axis)}",
        f"samples={int(analysis.get('samples', 256))}",
    ]
    if analysis.get("k_max_rad_per_m") is not None:
        kwargs.append(f"k_max_rad_per_m={_py_number(float(analysis['k_max_rad_per_m']))}")
    return f"fm.spin_wave_excitation({', '.join(kwargs)})"


def _render_geometry_expr(geometry: object, *, magnet_name: str, source_root: Path) -> str:
    if isinstance(geometry, ImportedGeometry):
        kwargs = [f"source={_py_repr(_relativize_path(geometry.source, source_root))}"]
        if geometry.scale != 1.0:
            kwargs.append(f"scale={_py_literal(geometry.scale)}")
        if geometry.volume != "full":
            kwargs.append(f"volume={_py_repr(geometry.volume)}")
        default_name = Path(geometry.source).stem
        if geometry.name is not None and geometry.name not in {default_name, f"{magnet_name}_geom"}:
            kwargs.append(f"name={_py_repr(geometry.name)}")
        return f"fm.ImportedGeometry({', '.join(kwargs)})"
    if isinstance(geometry, Box):
        args = ", ".join(_py_number(value) for value in geometry.size)
        if geometry.name in {"box", f"{magnet_name}_geom"}:
            return f"fm.Box({args})"
        return f"fm.Box({args}, name={_py_repr(geometry.name)})"
    if isinstance(geometry, Cylinder):
        args = f"radius={_py_number(geometry.radius)}, height={_py_number(geometry.height)}"
        if geometry.name in {"cylinder", f"{magnet_name}_geom"}:
            return f"fm.Cylinder({args})"
        return f"fm.Cylinder({args}, name={_py_repr(geometry.name)})"
    if isinstance(geometry, Ellipsoid):
        args = f"{_py_number(geometry.rx)}, {_py_number(geometry.ry)}, {_py_number(geometry.rz)}"
        if geometry.name in {"ellipsoid", f"{magnet_name}_geom"}:
            return f"fm.Ellipsoid({args})"
        return f"fm.Ellipsoid({args}, name={_py_repr(geometry.name)})"
    if isinstance(geometry, Ellipse):
        args = f"{_py_number(geometry.rx)}, {_py_number(geometry.ry)}, {_py_number(geometry.height)}"
        if geometry.name in {"ellipse", f"{magnet_name}_geom"}:
            return f"fm.Ellipse({args})"
        return f"fm.Ellipse({args}, name={_py_repr(geometry.name)})"
    if isinstance(geometry, Difference):
        base = _render_geometry_expr(geometry.base, magnet_name=magnet_name, source_root=source_root)
        tool = _render_geometry_expr(geometry.tool, magnet_name=magnet_name, source_root=source_root)
        expr = f"{base} - {tool}"
        if geometry.name not in {"difference", f"{magnet_name}_geom"}:
            expr = f"({expr})"
        return expr
    if isinstance(geometry, Union):
        return (
            f"{_render_geometry_expr(geometry.a, magnet_name=magnet_name, source_root=source_root)}"
            f" + "
            f"{_render_geometry_expr(geometry.b, magnet_name=magnet_name, source_root=source_root)}"
        )
    if isinstance(geometry, Intersection):
        return (
            f"{_render_geometry_expr(geometry.a, magnet_name=magnet_name, source_root=source_root)}"
            f" & "
            f"{_render_geometry_expr(geometry.b, magnet_name=magnet_name, source_root=source_root)}"
        )
    if isinstance(geometry, Translate):
        base = _render_geometry_expr(geometry.geometry, magnet_name=magnet_name, source_root=source_root)
        offset = ", ".join(_py_number(value) for value in geometry.offset)
        return f"{base}.translate(({offset}))"
    raise ValueError(f"unsupported geometry kind for canonical rewrite: {type(geometry).__name__}")


def _render_initial_magnetization(
    initializer: object,
    *,
    magnet_var: str,
    source_root: Path,
) -> str | list[str]:
    if isinstance(initializer, UniformMagnetization):
        return f"{magnet_var}.m = fm.uniform({_py_number(initializer.value[0])}, {_py_number(initializer.value[1])}, {_py_number(initializer.value[2])})"
    if isinstance(initializer, RandomMagnetization):
        return f"{magnet_var}.m = fm.random(seed={initializer.seed})"
    if isinstance(initializer, SampledMagnetization):
        if initializer.source_path:
            kwargs = []
            if initializer.source_format and initializer.source_format != "json":
                kwargs.append(f"format={_py_repr(initializer.source_format)}")
            if initializer.dataset and initializer.dataset != "values":
                kwargs.append(f"dataset={_py_repr(initializer.dataset)}")
            if initializer.sample_index not in {None, -1}:
                kwargs.append(f"sample={initializer.sample_index}")
            rendered_path = _py_repr(_relativize_path(initializer.source_path, source_root))
            suffix = f", {', '.join(kwargs)}" if kwargs else ""
            return [f"{magnet_var}.m.loadfile({rendered_path}{suffix})"]
        raise ValueError(
            "canonical flat-script rewrite requires sampled-field initial magnetization to come from loadfile(...)"
        )
    raise ValueError(
        f"unsupported initial magnetization kind for canonical rewrite: {type(initializer).__name__}"
    )


def _render_initial_state_override(
    override: dict[str, object],
    *,
    magnet_name: str,
    magnet_var: str,
    source_root: Path,
) -> list[str] | None:
    if not override:
        return None
    override_path = override.get("source_path")
    if not isinstance(override_path, str) or not override_path.strip():
        return None
    target_magnet = override.get("magnet_name")
    if isinstance(target_magnet, str) and target_magnet.strip() and target_magnet != magnet_name:
        return None

    kwargs = []
    override_format = override.get("format")
    if isinstance(override_format, str) and override_format.strip() and override_format != "json":
        kwargs.append(f"format={_py_repr(override_format)}")
    override_dataset = override.get("dataset")
    if isinstance(override_dataset, str) and override_dataset.strip() and override_dataset != "values":
        kwargs.append(f"dataset={_py_repr(override_dataset)}")
    override_sample = override.get("sample_index")
    if isinstance(override_sample, int) and override_sample >= 0:
        kwargs.append(f"sample={override_sample}")

    rendered_path = _py_repr(_relativize_path(override_path, source_root))
    suffix = f", {', '.join(kwargs)}" if kwargs else ""
    return [f"{magnet_var}.m.loadfile({rendered_path}{suffix})"]


def _export_initial_state(problem: Problem) -> dict[str, object] | None:
    if len(problem.magnets) != 1:
        return None
    magnet = problem.magnets[0]
    if not isinstance(magnet.m0, SampledMagnetization) or not magnet.m0.source_path:
        return None

    return {
        "magnet_name": magnet.name,
        "source_path": str(Path(magnet.m0.source_path).resolve()),
        "format": magnet.m0.source_format
        or infer_magnetization_state_format(magnet.m0.source_path),
        "dataset": magnet.m0.dataset,
        "sample_index": magnet.m0.sample_index,
    }


def _export_geometry_entry(magnet: object, problem: Problem) -> dict[str, object]:
    """Serialize one magnet into a geometry entry for the builder draft."""
    geom = magnet.geometry
    mat = magnet.material

    # --- Geometry kind + params ---
    geometry_kind, geometry_params = _export_geometry_kind_params(geom)

    # --- Material ---
    material: dict[str, object] = {
        "Ms": mat.Ms if mat.Ms is not None else None,
        "Aex": mat.A if mat.A is not None else None,
        "alpha": mat.alpha,
        "Dind": None,
    }
    dmi_val = _magnet_dmi(problem, magnet.name)
    if dmi_val is not None:
        material["Dind"] = dmi_val

    # --- Magnetization ---
    magnetization: dict[str, object] = {"kind": "uniform", "value": [1, 0, 0], "seed": None, "source_path": None}
    if magnet.m0 is not None:
        if isinstance(magnet.m0, UniformMagnetization):
            magnetization = {"kind": "uniform", "value": list(magnet.m0.value), "seed": None, "source_path": None}
        elif isinstance(magnet.m0, RandomMagnetization):
            magnetization = {"kind": "random", "value": None, "seed": magnet.m0.seed, "source_path": None}
        elif isinstance(magnet.m0, SampledMagnetization):
            magnetization = {
                "kind": "file",
                "value": None,
                "seed": None,
                "source_path": magnet.m0.source_path,
                "source_format": magnet.m0.source_format,
                "dataset": magnet.m0.dataset,
                "sample_index": magnet.m0.sample_index,
            }

    # --- Per-geometry mesh ---
    fem = problem.discretization.fem if problem.discretization is not None else None
    per_mesh: dict[str, object] | None = None
    if isinstance(fem, FEM):
        per_mesh = {
            "hmax": _text_number(fem.hmax),
            "order": fem.order,
            "build_requested": True,
        }

    return {
        "name": magnet.name,
        "geometry_kind": geometry_kind,
        "geometry_params": geometry_params,
        "material": material,
        "magnetization": magnetization,
        "mesh": per_mesh,
    }


def _export_current_module_entry(module: object) -> dict[str, object]:
    if not isinstance(module, AntennaFieldSource):
        raise ValueError(f"unsupported current module kind: {type(module).__name__}")
    antenna = module.antenna
    antenna_kind = type(antenna).__name__
    if isinstance(antenna, MicrostripAntenna):
        antenna_params = {
            "width": antenna.width,
            "thickness": antenna.thickness,
            "height_above_magnet": antenna.height_above_magnet,
            "preview_length": antenna.preview_length,
            "center_x": antenna.center_x,
            "center_y": antenna.center_y,
        }
    elif isinstance(antenna, CPWAntenna):
        antenna_params = {
            "signal_width": antenna.signal_width,
            "gap": antenna.gap,
            "ground_width": antenna.ground_width,
            "thickness": antenna.thickness,
            "height_above_magnet": antenna.height_above_magnet,
            "preview_length": antenna.preview_length,
            "center_x": antenna.center_x,
            "center_y": antenna.center_y,
        }
    else:
        raise ValueError(f"unsupported antenna kind: {type(antenna).__name__}")

    drive = {
        "current_a": module.drive.current_a,
        "frequency_hz": module.drive.frequency_hz,
        "phase_rad": module.drive.phase_rad,
        "waveform": module.drive.waveform.to_ir() if module.drive.waveform is not None else None,
    }
    return {
        "kind": "antenna_field_source",
        "name": module.name,
        "solver": module.solver,
        "air_box_factor": module.air_box_factor,
        "antenna_kind": antenna_kind,
        "antenna_params": antenna_params,
        "drive": drive,
    }


def _export_excitation_analysis(problem: Problem) -> dict[str, object] | None:
    analysis = problem.excitation_analysis
    if analysis is None:
        return None
    return analysis.to_ir()


def _export_geometry_kind_params(geom: object) -> tuple[str, dict[str, object]]:
    """Extract kind string and parameter dict from a geometry object."""
    if isinstance(geom, ImportedGeometry):
        return "ImportedGeometry", {
            "source": geom.source,
            "scale": geom.scale,
            "volume": geom.volume,
            "name": geom.name,
        }
    if isinstance(geom, Box):
        return "Box", {"size": list(geom.size)}
    if isinstance(geom, Cylinder):
        return "Cylinder", {"radius": geom.radius, "height": geom.height}
    if isinstance(geom, Ellipsoid):
        return "Ellipsoid", {"rx": geom.rx, "ry": geom.ry, "rz": geom.rz}
    if isinstance(geom, Ellipse):
        return "Ellipse", {"rx": geom.rx, "ry": geom.ry, "height": geom.height}
    if isinstance(geom, Translate):
        base_kind, base_params = _export_geometry_kind_params(geom.geometry)
        return base_kind, {**base_params, "translate": list(geom.offset)}
    if isinstance(geom, Difference):
        return "Difference", {"base": str(type(geom.base).__name__), "tool": str(type(geom.tool).__name__)}
    if isinstance(geom, Union):
        return "Union", {"a": str(type(geom.a).__name__), "b": str(type(geom.b).__name__)}
    if isinstance(geom, Intersection):
        return "Intersection", {"a": str(type(geom.a).__name__), "b": str(type(geom.b).__name__)}
    return type(geom).__name__, {}


def _study_outputs(study: TimeEvolution | Relaxation | Eigenmodes) -> Sequence[object]:
    return tuple(study.outputs)


def _magnet_dmi(problem: Problem, magnet_name: str) -> float | None:
    del magnet_name
    for term in problem.energy:
        if isinstance(term, InterfacialDMI):
            return term.D
    return None


def _snapshot_quantity_string(snapshot: Snapshot) -> str:
    if snapshot.component == "3D":
        return snapshot.field
    if snapshot.field == "m":
        return f"m{snapshot.component}"
    return f"{snapshot.field}_{snapshot.component}"


def _runtime_device_spec(runtime) -> str:
    device = runtime.device_target.value
    if device == "cpu":
        return "cpu"
    if device in {"cuda", "gpu"}:
        index = runtime.device_index if runtime.device_index is not None else 0
        return f"cuda:{index}"
    return device


def _magnet_variable_names(
    problem: Problem,
    overrides: dict[str, object] | None = None,
) -> dict[str, str]:
    geometries_override = (overrides or {}).get("geometries")
    if isinstance(geometries_override, list):
        if len(geometries_override) == 1:
            name = _normalize_mapping(geometries_override[0]).get("name")
            return {str(name): "body"} if name else {}
        return {
            str(_normalize_mapping(g).get("name")): f"body_{i}"
            for i, g in enumerate(geometries_override, 1)
        }

    used: set[str] = set()
    mapping: dict[str, str] = {}
    for magnet in problem.magnets:
        base = re.sub(r"[^a-zA-Z0-9_]+", "_", magnet.name).strip("_").lower() or "body"
        if base[0].isdigit():
            base = f"m_{base}"
        candidate = base
        suffix = 2
        while candidate in used:
            candidate = f"{base}_{suffix}"
            suffix += 1
        used.add(candidate)
        mapping[magnet.name] = candidate
    return mapping


def _normalize_mapping(value: object) -> dict[str, object]:
    return dict(value) if isinstance(value, dict) else {}


def _override_string(overrides: dict[str, object], key: str, fallback: str | None) -> str | None:
    value = overrides.get(key, fallback)
    if value is None:
        return fallback
    if isinstance(value, str) and value.strip():
        return value.strip()
    return fallback


def _override_number(overrides: dict[str, object], key: str, fallback: float | None) -> float | None:
    if key not in overrides:
        return fallback
    value = overrides.get(key)
    if value is None:
        return None
    if isinstance(value, (int, float)):
        return float(value)
    return fallback


def _override_int(overrides: dict[str, object], key: str, fallback: int | None) -> int | None:
    if key not in overrides:
        return fallback
    value = overrides.get(key)
    if value is None:
        return None
    if isinstance(value, (int, float)):
        return int(value)
    return fallback


def _number_or_none(value: object) -> float | None:
    if isinstance(value, (int, float)):
        return float(value)
    return None


def _text_number(value: float | None) -> str:
    return "" if value is None else _py_number(value)


def _py_repr(value: str) -> str:
    return json.dumps(value)


def _py_number(value: float) -> str:
    return format(float(value), ".12g")


def _py_literal(value: object) -> str:
    if isinstance(value, bool):
        return "True" if value else "False"
    if isinstance(value, (int, float)):
        return _py_number(float(value))
    if isinstance(value, str):
        return _py_repr(value)
    if isinstance(value, tuple):
        return "(" + ", ".join(_py_literal(item) for item in value) + ")"
    if isinstance(value, list):
        return "[" + ", ".join(_py_literal(item) for item in value) + "]"
    if isinstance(value, dict):
        items = ", ".join(f"{_py_repr(str(key))}: {_py_literal(item)}" for key, item in sorted(value.items()))
        return "{" + items + "}"
    if value is None:
        return "None"
    raise ValueError(f"unsupported literal for canonical rewrite: {type(value).__name__}")


def _validate_stage_compatibility(stages: Sequence[LoadedStage]) -> None:
    if len(stages) <= 1:
        return
    baseline = _stage_signature(stages[0].problem)
    for stage in stages[1:]:
        signature = _stage_signature(stage.problem)
        if signature != baseline:
            raise ValueError(
                "canonical rewrite does not yet support stage-local geometry, material, or output mutations"
            )


def _stage_signature(problem: Problem) -> dict[str, object]:
    runtime_metadata = _normalize_mapping(problem.runtime_metadata)
    return {
        "name": problem.name,
        "runtime": problem.runtime.to_runtime_metadata(),
        "geometries": [_geometry_signature(magnet.geometry) for magnet in problem.magnets],
        "materials": [_material_signature(magnet) for magnet in problem.magnets],
        "magnets": [
            {
                "name": magnet.name,
                "geometry": magnet.geometry.geometry_name,
                "initial_magnetization": magnet.m0.to_ir() if magnet.m0 is not None else None,
            }
            for magnet in problem.magnets
        ],
        "energy_terms": [term.to_ir() for term in problem.energy],
        "current_modules": [module.to_ir() for module in problem.current_modules],
        "excitation_analysis": problem.excitation_analysis.to_ir()
        if problem.excitation_analysis is not None
        else None,
        "discretization": problem.discretization.to_ir() if problem.discretization else None,
        "outputs": [output.to_ir() for output in _study_outputs(problem.study)],
        "mesh_workflow": runtime_metadata.get("mesh_workflow"),
        "interactive": runtime_metadata.get("interactive_session_requested"),
        "wait_for_solve": runtime_metadata.get("wait_for_solve"),
    }


def _geometry_signature(geometry: object) -> dict[str, object]:
    if hasattr(geometry, "to_ir"):
        return geometry.to_ir()
    raise ValueError(f"unsupported geometry signature kind: {type(geometry).__name__}")


def _material_signature(magnet) -> dict[str, object]:
    material = dict(magnet.material.to_ir())
    # Flat relax stages temporarily rewrite damping to the relaxation alpha, but
    # the canonical script still expresses that as fm.relax(...), not as a
    # stage-local material mutation. Ignore alpha here so ordinary relax->run
    # sequences remain rewriteable.
    material.pop("damping", None)
    return material


def _relativize_path(path_value: str, source_root: Path) -> str:
    path = Path(path_value)
    if not path.is_absolute():
        return path_value
    try:
        return str(path.relative_to(source_root))
    except ValueError:
        return path_value


def _validate_energy_terms(problem: Problem) -> None:
    exchange_count = 0
    demag_count = 0
    zeeman_count = 0
    dmi_count = 0
    for term in problem.energy:
        if isinstance(term, Exchange):
            exchange_count += 1
            continue
        if isinstance(term, Zeeman):
            zeeman_count += 1
            continue
        if isinstance(term, InterfacialDMI):
            dmi_count += 1
            continue
        if isinstance(term, Demag):
            demag_count += 1
            if term.realization not in {None, "auto"}:
                raise ValueError(
                    "canonical flat-script rewrite does not yet support explicit demag realizations"
                )
            continue
        raise ValueError(
            f"canonical flat-script rewrite does not yet support energy term {type(term).__name__}"
        )
    if exchange_count != 1 or demag_count != 1:
        raise ValueError(
            "canonical flat-script rewrite currently expects exactly one exchange term and one demag term"
        )
    if zeeman_count > 1 or dmi_count > 1:
        raise ValueError(
            "canonical flat-script rewrite does not yet support multiple Zeeman or DMI terms"
        )


def _builder_source_kind(entrypoint_kind: str) -> str:
    if entrypoint_kind.startswith("flat_"):
        return "flat_script"
    if entrypoint_kind == "build":
        return "build_function"
    if entrypoint_kind == "problem":
        return "problem_object"
    if entrypoint_kind.startswith("interactive_"):
        return "interactive_command"
    return "problem_model"
