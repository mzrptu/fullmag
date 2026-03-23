# Mesh and region discretization

- Status: draft
- Last updated: 2026-03-23

## 1. Problem statement

Mesh, voxelization, region tagging i mapowanie materiałów są pierwszym miejscem, gdzie wspólny opis fizyki spotyka konkretną reprezentację numeryczną. Ten etap wymaga szczególnej ostrożności, bo łatwo tu przemycić backend-specific semantics do warstwy wspólnej.

## 2. Physical model

Geometria i regiony nie są samodzielnym członem energii, ale definiują domenę, na której pola i materiały mają znaczenie fizyczne. Region tagging wpływa na poprawność parametrów materiałowych, energii międzyobszarowych i warunków brzegowych.

## 3. Numerical interpretation

### 3.1 FDM

Geometria jest voxelizowana na regularny grid, a regiony stają się maskami komórkowymi.

### 3.2 FEM

Geometria jest meshowana, a regiony są odwzorowane jako znaczniki domeny / atrybuty elementów.

### 3.3 Hybrid

Potrzebne są jawne operatory projekcji oraz zachowanie zgodności semantycznej regionów między mesh i auxiliary grid.

## 4. API, IR, and planner impact

- Python API musi rozdzielać geometrię, region i materiał.
- `ProblemIR` musi przechowywać referencje geometrii i przypisania regionów bez narzucania siatki.
- Planner decyduje o voxelization/meshing/projection.

## 5. Validation strategy

- proste geometrie analityczne,
- testy spójności objętości i region fractions,
- porównanie region assignment między backendami.

## 6. Completeness checklist

- [ ] Python API
- [ ] ProblemIR
- [ ] Planner
- [ ] Capability matrix
- [ ] FDM backend
- [ ] FEM backend
- [ ] Hybrid backend
- [ ] Outputs / observables
- [ ] Tests / benchmarks
- [ ] Documentation

## 7. Known limits and deferred work

- import STEP/STL/MSH nie jest jeszcze zaimplementowany,
- nie określono jeszcze zasad mesh repair ani curved geometry fidelity.
