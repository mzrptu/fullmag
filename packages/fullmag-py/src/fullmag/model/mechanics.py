from __future__ import annotations

from dataclasses import dataclass
from typing import Sequence

from fullmag._validation import as_vector3, require_non_empty, require_positive, require_non_negative


# ── Elastic material ──────────────────────────────────────


@dataclass(frozen=True, slots=True)
class ElasticMaterial:
    """Linear elastic material with cubic or isotropic symmetry.

    Parameters
    ----------
    name : str
        Unique material name.
    C11, C12, C44 : float
        Independent cubic elastic constants [Pa].
    rho : float
        Mass density [kg/m³].
    eta_mech : float, optional
        Mechanical damping coefficient (dimensionless).
    """

    name: str
    C11: float
    C12: float
    C44: float
    rho: float
    eta_mech: float | None = None

    def __post_init__(self) -> None:
        object.__setattr__(self, "name", require_non_empty(self.name, "name"))
        require_positive(self.C11, "C11")
        require_positive(self.C12, "C12")
        require_positive(self.C44, "C44")
        require_positive(self.rho, "rho")
        if self.eta_mech is not None:
            require_non_negative(self.eta_mech, "eta_mech")

    def to_ir(self) -> dict[str, object]:
        ir: dict[str, object] = {
            "name": self.name,
            "c11": self.C11,
            "c12": self.C12,
            "c44": self.C44,
            "density": self.rho,
        }
        if self.eta_mech is not None:
            ir["mechanical_damping"] = self.eta_mech
        return ir


# ── Elastic body ──────────────────────────────────────────


@dataclass(frozen=True, slots=True)
class ElasticBody:
    """Elastic domain bound to a geometry and an elastic material.

    Parameters
    ----------
    name : str
        Unique body name.
    geometry : Geometry
        Geometry object defining the domain.
    elastic_material : ElasticMaterial
        Elastic material properties.
    """

    name: str
    geometry: object  # fullmag.model.geometry.Geometry
    elastic_material: ElasticMaterial

    def __post_init__(self) -> None:
        object.__setattr__(self, "name", require_non_empty(self.name, "name"))

    def to_ir(self) -> dict[str, object]:
        return {
            "name": self.name,
            "geometry": self.geometry.geometry_name,
            "elastic_material": self.elastic_material.name,
        }


# ── Magnetostriction law ─────────────────────────────────


@dataclass(frozen=True, slots=True)
class MagnetostrictionLaw:
    """Magnetostriction coupling law.

    Parameters
    ----------
    name : str
        Unique law name.
    kind : str
        ``"cubic"`` or ``"isotropic"``.
    B1, B2 : float, optional
        Cubic coupling constants [Pa]. Required for ``kind="cubic"``.
    lambda_s : float, optional
        Isotropic saturation magnetostriction [1]. Required for ``kind="isotropic"``.
    """

    name: str
    kind: str = "cubic"
    B1: float | None = None
    B2: float | None = None
    lambda_s: float | None = None

    def __post_init__(self) -> None:
        object.__setattr__(self, "name", require_non_empty(self.name, "name"))
        if self.kind not in ("cubic", "isotropic"):
            raise ValueError(f"MagnetostrictionLaw kind must be 'cubic' or 'isotropic', got {self.kind!r}")
        if self.kind == "cubic":
            if self.B1 is None or self.B2 is None:
                raise ValueError("Cubic magnetostriction requires B1 and B2")
        if self.kind == "isotropic":
            if self.lambda_s is None:
                raise ValueError("Isotropic magnetostriction requires lambda_s")

    def to_ir(self) -> dict[str, object]:
        if self.kind == "cubic":
            return {"kind": "cubic", "name": self.name, "b1": self.B1, "b2": self.B2}
        return {"kind": "isotropic", "name": self.name, "lambda_s": self.lambda_s}


# ── Mechanical boundary conditions ───────────────────────


@dataclass(frozen=True, slots=True)
class MechanicalBoundaryCondition:
    """Mechanical boundary condition.

    Parameters
    ----------
    kind : str
        One of ``"traction_free"``, ``"clamped"``, ``"prescribed_displacement"``,
        ``"prescribed_traction"``.
    surface : str
        Name of the boundary surface.
    u : sequence of 3 floats, optional
        Prescribed displacement [m]. Required for ``"prescribed_displacement"``.
    t : sequence of 3 floats, optional
        Prescribed traction [Pa]. Required for ``"prescribed_traction"``.
    """

    kind: str
    surface: str
    u: tuple[float, float, float] | None = None
    t: tuple[float, float, float] | None = None

    _ALLOWED_KINDS = ("traction_free", "clamped", "prescribed_displacement", "prescribed_traction")

    def __init__(
        self,
        kind: str,
        surface: str,
        u: Sequence[float] | None = None,
        t: Sequence[float] | None = None,
    ) -> None:
        if kind not in self._ALLOWED_KINDS:
            raise ValueError(
                f"MechanicalBoundaryCondition kind must be one of {self._ALLOWED_KINDS!r}, got {kind!r}"
            )
        object.__setattr__(self, "kind", kind)
        object.__setattr__(self, "surface", require_non_empty(surface, "surface"))
        object.__setattr__(self, "u", as_vector3(u, "u") if u is not None else None)
        object.__setattr__(self, "t", as_vector3(t, "t") if t is not None else None)

        if kind == "prescribed_displacement" and self.u is None:
            raise ValueError("prescribed_displacement requires u")
        if kind == "prescribed_traction" and self.t is None:
            raise ValueError("prescribed_traction requires t")

    def to_ir(self) -> dict[str, object]:
        ir: dict[str, object] = {"kind": self.kind, "surface": self.surface}
        if self.u is not None:
            ir["u"] = list(self.u)
        if self.t is not None:
            ir["t"] = list(self.t)
        return ir


# ── Mechanical loads ──────────────────────────────────────


@dataclass(frozen=True, slots=True)
class MechanicalLoad:
    """External mechanical load.

    Parameters
    ----------
    kind : str
        One of ``"body_force"``, ``"prescribed_strain"``, ``"prescribed_stress"``.
    f : sequence of 3 floats, optional
        Body force density [N/m³]. Required for ``"body_force"``.
    strain : sequence of 6 floats, optional
        Prescribed strain (Voigt). Required for ``"prescribed_strain"``.
    stress : sequence of 6 floats, optional
        Prescribed stress (Voigt, Pa). Required for ``"prescribed_stress"``.
    """

    kind: str
    f: tuple[float, float, float] | None = None
    strain: tuple[float, ...] | None = None
    stress: tuple[float, ...] | None = None

    _ALLOWED_KINDS = ("body_force", "prescribed_strain", "prescribed_stress")

    def __post_init__(self) -> None:
        if self.kind not in self._ALLOWED_KINDS:
            raise ValueError(
                f"MechanicalLoad kind must be one of {self._ALLOWED_KINDS!r}, got {self.kind!r}"
            )
        if self.kind == "body_force" and self.f is None:
            raise ValueError("body_force requires f")
        if self.kind == "prescribed_strain" and self.strain is None:
            raise ValueError("prescribed_strain requires strain (Voigt 6-component)")
        if self.kind == "prescribed_stress" and self.stress is None:
            raise ValueError("prescribed_stress requires stress (Voigt 6-component)")
        if self.strain is not None and len(self.strain) != 6:
            raise ValueError("strain must have 6 components (Voigt notation)")
        if self.stress is not None and len(self.stress) != 6:
            raise ValueError("stress must have 6 components (Voigt notation)")

    def to_ir(self) -> dict[str, object]:
        ir: dict[str, object] = {"kind": self.kind}
        if self.f is not None:
            ir["f"] = list(self.f)
        if self.strain is not None:
            ir["strain"] = list(self.strain)
        if self.stress is not None:
            ir["stress"] = list(self.stress)
        return ir
