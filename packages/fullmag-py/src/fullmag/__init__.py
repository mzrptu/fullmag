"""Public embedded Python DSL for Fullmag."""

from .init import uniform
from .model import (
    Demag,
    DiscretizationHints,
    Exchange,
    ExecutionMode,
    FDM,
    FEM,
    Ferromagnet,
    Hybrid,
    ImportedGeometry,
    InterfacialDMI,
    LLG,
    Material,
    Problem,
    Region,
    SaveField,
    SaveScalar,
    Zeeman,
)
from .runtime import BackendTarget, Result, Simulation, load_problem_from_script

__all__ = [
    "BackendTarget",
    "Demag",
    "DiscretizationHints",
    "Exchange",
    "ExecutionMode",
    "FDM",
    "FEM",
    "Ferromagnet",
    "Hybrid",
    "ImportedGeometry",
    "InterfacialDMI",
    "LLG",
    "Material",
    "Problem",
    "Region",
    "Result",
    "SaveField",
    "SaveScalar",
    "Simulation",
    "Zeeman",
    "load_problem_from_script",
    "uniform",
]
