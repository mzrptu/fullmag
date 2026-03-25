# Multi-Region Physics in Fullmag: Deep Analysis and Design

*Physics note for the design of fullmag's multi-material solver.*

---

## 1. The Problem

Consider two adjacent magnetic bodies Ω₁ and Ω₂ with different material parameters (Ms, A, α, K, D) sharing an interface Σ. We must correctly handle:

1. **Exchange coupling** across Σ (continuous bulk exchange + optional surface exchange)
2. **Demagnetization** (each body generates stray field that acts on the other)
3. **Interfacial DMI** (broken inversion symmetry at Σ)
4. **Independent LLG dynamics** (different α, Ms per body)

---

## 2. Exchange Energy: Variational Derivation of Interface Conditions

### 2.1 Bulk exchange energy functional

For a system of two magnetic bodies, the total exchange energy is:

$$E_\text{ex} = \int_{\Omega_1} A_1 |\nabla \mathbf{m}_1|^2 \, dV + \int_{\Omega_2} A_2 |\nabla \mathbf{m}_2|^2 \, dV$$

where **m** = M/Ms is the unit magnetization vector.

### 2.2 Variation and natural boundary conditions

Taking the first variation δE_ex = 0 and applying integration by parts (Green's first identity):

$$\delta E_\text{ex} = -\int_{\Omega_1} 2A_1 \nabla^2 \mathbf{m}_1 \cdot \delta\mathbf{m}_1 \, dV - \int_{\Omega_2} 2A_2 \nabla^2 \mathbf{m}_2 \cdot \delta\mathbf{m}_2 \, dV$$
$$+ \oint_{\partial\Omega_1} 2A_1 (\nabla \mathbf{m}_1 \cdot \mathbf{n}_1) \cdot \delta\mathbf{m}_1 \, dS + \oint_{\partial\Omega_2} 2A_2 (\nabla \mathbf{m}_2 \cdot \mathbf{n}_2) \cdot \delta\mathbf{m}_2 \, dS$$

The bulk terms give the usual exchange field **H_ex** = (2A / μ₀Ms) ∇²**m**.

At the interface Σ, where ∂Ω₁ and ∂Ω₂ meet with **n**₁₂ = **n**₁ = −**n**₂:

> **Continuity condition (no surface exchange):**
>
> $$A_1 \frac{\partial \mathbf{m}_1}{\partial n}\bigg|_{\Sigma} = A_2 \frac{\partial \mathbf{m}_2}{\partial n}\bigg|_{\Sigma}$$

This is the **jump condition**: the normal component of the exchange "flux" A·∂m/∂n is continuous across the interface. This is analogous to heat conduction across a material boundary (continuity of heat flux k·∂T/∂n).

> [!IMPORTANT]
> **This is NOT a harmonic mean.** This is a rigorous boundary condition derived from variational calculus. Any solver that uses `A_eff = 2A₁A₂/(A₁+A₂)` is making an approximation that conflates the BC with the FD stencil.

### 2.3 Surface exchange (interlayer coupling)

When an additional RKKY-style coupling exists across the interface (e.g. through a non-magnetic spacer), we add a surface energy term:

$$E_\text{IEC} = -\int_{\Sigma} \sigma_1 \, (\mathbf{m}_1 \cdot \mathbf{m}_2) \, dA - \int_{\Sigma} \sigma_2 \, (\mathbf{m}_1 \cdot \mathbf{m}_2)^2 \, dA$$

where σ₁ [J/m²] is the bilinear coupling and σ₂ [J/m²] is the biquadratic coupling.

Taking the variation and combining with the bulk exchange:

> **Robin boundary condition (with IEC):**
>
> $$A_1 \frac{\partial \mathbf{m}_1}{\partial n}\bigg|_{\Sigma} = \sigma_1 \big[\mathbf{m}_2 - (\mathbf{m}_1 \cdot \mathbf{m}_2)\mathbf{m}_1\big] + 2\sigma_2 (\mathbf{m}_1 \cdot \mathbf{m}_2) \big[\mathbf{m}_2 - (\mathbf{m}_1 \cdot \mathbf{m}_2)\mathbf{m}_1\big]$$
>
> (and symmetrically for m₂ with A₂, n₂ = −n₁)

This is a Robin-type BC. It reduces to the Neumann condition ∂m/∂n = 0 at a free surface (no coupling), and to the continuity condition when σ → ∞ (perfect coupling, same material).

---

## 3. Finite-Difference Discretization at the Interface

### 3.1 The problem with the harmonic mean

In mumax3, the exchange field at cell i adjacent to cell j (different material) uses:

$$H_{\text{ex},i} = \frac{2A_\text{eff}}{\mu_0 M_{s,i} \Delta^2} (\mathbf{m}_j - \mathbf{m}_i), \quad A_\text{eff} = \frac{2A_i A_j}{A_i + A_j}$$

This harmonic mean arises from treating the interface as two resistors in series (1/A_eff = 1/(2A₁) + 1/(2A₂)). It's an **ad-hoc approximation** that:
- Assumes the interface lies exactly at the cell boundary
- Cannot represent σ-type surface exchange
- Gives wrong results when Ms₁ ≠ Ms₂ (the effective field should scale differently on each side)
- Cannot be decoupled: you can't turn off exchange between two touching regions without zeroing A

### 3.2 Virtual-point method (correct approach)

Consider a 1D interface at x = x_I between materials 1 (cells i-1, i) and 2 (cells i+1, i+2). The cell spacing is Δ.

**Standard 3-point Laplacian** for cell i (in material 1):

$$\nabla^2 m\big|_i \approx \frac{m_{i+1} - 2m_i + m_{i-1}}{\Delta^2}$$

But m_{i+1} is in material 2, so the stencil crosses the interface. Instead, introduce a **virtual point** m* at the interface:

**From the jump condition** A₁ ∂m₁/∂n = A₂ ∂m₂/∂n at x_I:

$$A_1 \frac{m^* - m_i}{\Delta/2} = A_2 \frac{m_{i+1} - m^*}{\Delta/2}$$

Solving for m*:

$$m^* = \frac{A_1 m_i + A_2 m_{i+1}}{A_1 + A_2}$$

Substituting back into the Laplacian for cell i:

$$\nabla^2 m\big|_i \approx \frac{m^* - 2m_i + m_{i-1}}{\Delta^2/2} = \frac{2}{\Delta^2} \left[\frac{A_2}{A_1 + A_2}(m_{i+1} - m_i) + (m_{i-1} - m_i)\right]$$

This looks like a harmonic mean but is derived rigorously. The crucial difference: the effective field on side 1 uses A₁ and Ms₁:

$$\mathbf{H}_{\text{ex},i} = \frac{2A_1}{\mu_0 M_{s,1}} \nabla^2 m\big|_i$$

while the effective field on side 2 uses A₂ and Ms₂. **Each mesh computes its own exchange field with its own material parameters.**

### 3.3 Virtual-point method with surface exchange

When IEC is present, the jump condition becomes:

$$A_1 \frac{m^* - m_i}{\Delta/2} = \sigma_1 \big[m_{i+1} - (m_i \cdot m_{i+1})m_i\big]$$

This modifies the effective field at cell i:

$$\mathbf{H}_{\text{ex},i}^{\text{IEC}} = \frac{2\sigma_1}{\mu_0 M_{s,1} \Delta} \big[\mathbf{m}_{i+1} - (\mathbf{m}_i \cdot \mathbf{m}_{i+1})\mathbf{m}_i\big]$$

Note: σ₁ divides by Δ (not Δ²) because it's a **surface** energy density [J/m²], not a volume energy density [J/m³].

---

## 4. Demagnetization in Multi-Mesh Systems

### 4.1 Self-demagnetization

Each mesh k has its own Newell tensor kernel:

$$\mathbf{H}_{\text{demag},k}^{\text{self}}(\mathbf{r}) = -\sum_{\alpha} \hat{e}_\alpha \sum_{\beta} \sum_{\mathbf{r}'} N_{\alpha\beta}(\mathbf{r} - \mathbf{r}') \, M_{s,k} \, m_{\beta,k}(\mathbf{r}')$$

Computed via FFT convolution on each mesh's own grid.

### 4.2 Cross-mesh stray field

The stray field from mesh j acting on mesh k:

$$\mathbf{H}_{\text{demag},k\leftarrow j}(\mathbf{r}) = -\sum_{\alpha\beta} \sum_{\mathbf{r}' \in \Omega_j} N_{\alpha\beta}(\mathbf{r} - \mathbf{r}' - \Delta\mathbf{r}_{jk}) \, M_{s,j} \, m_{\beta,j}(\mathbf{r}')$$

where Δr_jk is the relative position offset between the grids.

**Key feature**: N_αβ here uses the **inter-mesh Newell tensor** — the cell dimensions in the kernel are those of the **source** mesh j, but the evaluation point is in mesh k. For aligned grids (same dx, dy) this simplifies to the same kernel with a z-offset.

> [!NOTE]
> Fullmag **already implements this** in `MultilayerDemagRuntime` using z-shifted Newell tensors with FFT convolution. Each layer has its own FFT workspace. The L² pairwise cross-convolution is the dominant cost.

### 4.3 Supermesh optimization

When multiple meshes share the same (dx, dy) and are stacked along z, we can define a supermesh that encompasses all layers and compute demag in one FFT operation with padded z-dimension. This is exactly what Boris v3.8 introduced. Fullmag's multilayer convolution already does this.

---

## 5. Interfacial DMI at Material Boundaries

### 5.1 iDMI energy density

The interfacial DMI energy density (Néel type, for HM/FM interfaces) is:

$$E_\text{iDMI} = D \big[m_z (\nabla \cdot \mathbf{m}) - (\mathbf{m} \cdot \nabla) m_z\big]$$

where D [J/m²] is the DMI constant. For a thin film of thickness t, the effective volume-averaged DMI constant is D_eff = D_s / t, where D_s is the surface DMI.

### 5.2 Multi-mesh treatment

In a bilayer HM/FM:
- The DMI only exists in the FM layer, induced by the interface
- D is an intrinsic property of the FM mesh (like A, Ms)
- No cross-mesh DMI term needed — it's fully contained in the FM mesh's energy calculation

For a symmetric sandwich FM/HM/FM:
- Each FM layer has its own D with opposite sign (top vs bottom interface)
- This naturally arises from the multi-mesh approach: each mesh has its own D parameter

> [!IMPORTANT]
> In a single-grid solver (mumax), you'd need to assign D per region and handle sign flips at interfaces — error-prone. In multi-mesh, each layer's D is independent and physically clear.

---

## 6. LLG Dynamics in Multi-Material Systems

### 6.1 Per-mesh LLG

Each mesh k evolves independently:

$$\frac{d\mathbf{m}_k}{dt} = -\gamma_0 \, \mathbf{m}_k \times \mathbf{H}_{\text{eff},k} + \alpha_k \, \mathbf{m}_k \times \frac{d\mathbf{m}_k}{dt}$$

where the effective field includes contributions from all meshes:

$$\mathbf{H}_{\text{eff},k} = \mathbf{H}_{\text{ex},k}^{\text{bulk}} + \mathbf{H}_{\text{ex},k}^{\text{IEC}} + \mathbf{H}_{\text{demag},k}^{\text{self}} + \sum_{j \neq k} \mathbf{H}_{\text{demag},k\leftarrow j} + \mathbf{H}_{\text{anis},k} + \mathbf{H}_{\text{ext}} + \mathbf{H}_{\text{iDMI},k}$$

### 6.2 Time stepping

Critical: all meshes must be stepped **synchronously** (same dt) because the demag cross-coupling means they're not independent. The time integrator evaluates all meshes' right-hand sides at the same time point.

For adaptive integrators (RK23, RK45): the error estimate is the **maximum** normalized error across all meshes. This ensures the step size is controlled by the fastest-changing material.

---

## 7. Proposed Fullmag Architecture

### 7.1 Data model

```
Simulation
├── Mesh₁ (FdmGrid: nx, ny, nz, dx, dy, dz, origin)
│   ├── Material₁ (Ms, A, α, K, D, ...)
│   ├── m₁[nx, ny, nz, 3]   (magnetization state)
│   ├── H_eff₁[nx, ny, nz, 3] (effective field workspace)
│   └── FFTWorkspace₁ (self-demag kernel, plans)
│
├── Mesh₂ (FdmGrid: nx, ny, nz, dx, dy, dz, origin)
│   ├── Material₂ (Ms, A, α, K, D, ...)
│   ├── m₂[nx, ny, nz, 3]
│   ├── H_eff₂[nx, ny, nz, 3]
│   └── FFTWorkspace₂
│
├── CrossDemagKernels
│   ├── Kernel₁₂ (Newell tensor with offset r₂ - r₁)
│   └── Kernel₂₁ (= transpose of Kernel₁₂)
│
└── Couplings
    └── Coupling₁₂
        ├── type: "direct" | "rkky"
        ├── σ₁: bilinear [J/m²]
        ├── σ₂: biquadratic [J/m²]
        └── interface_cells: [(i₁, i₂), ...]  (precomputed link list)
```

### 7.2 Computation flow per timestep

```
1. For each mesh k (parallel):
   a. Compute H_ex_bulk[k]     — 6-neighbor Laplacian with A_k, Neumann BC at free surfaces
   b. Compute H_anis[k]        — uniaxial anisotropy with K_k
   c. Compute H_iDMI[k]        — if D_k ≠ 0
   d. Compute H_demag_self[k]  — FFT convolution on mesh k's own kernel

2. For each mesh pair (j, k) (parallel over pairs):
   a. Compute H_demag_cross[k←j] — cross-convolution with z-offset kernel
   b. Compute H_IEC[k←j]         — surface exchange from coupling link list

3. Assemble H_eff[k] = sum of all field contributions + H_ext

4. Time step: evaluate dm/dt for all meshes simultaneously
   → adaptive error = max(error_k over all k)
```

### 7.3 Interface cell detection

At initialization, for each mesh pair (j, k), find all cell pairs (i_j, i_k) where the cells are adjacent (within tolerance). This produces the **link list** for surface exchange — exactly like OOMMF's `Oxs_TwoSurfaceExchange.FillLinkList()`.

For aligned meshes (same dx, dy, stacked along z):
- The link list is trivial: all (x, y) positions in the overlap region
- Each cell in the top layer of mesh j links to the corresponding cell in the bottom layer of mesh k

For non-aligned meshes:
- Use nearest-neighbor search in the overlap volume
- Interpolate magnetization from the finer mesh to the coarser mesh at the interface

### 7.4 Why this is better than each predecessor

| Aspect | mumax3 problem | OOMMF problem | This design |
|---|---|---|---|
| Resolution | Single grid for all | Single grid for all | Independent grid per material |
| Exchange BC | Harmonic mean hack | Explicit A[ri][rj] but single grid | Virtual-point with correct BC per side |
| Surface exchange | ext_InterExchange (bolt-on) | TwoSurfaceExchange (separate energy) | Unified framework: σ in coupling object |
| Demag | Single FFT, single resolution | Single FFT | O(L²) pairwise convolution, already implemented |
| DMI at interface | Region-level D, sign management | Not supported in base | Per-mesh D, physically natural |
| Region limit | 256 | Practical ∞ but single grid | ∞, independent meshes |
| Memory | Wastes cells on spacers | Same | Each mesh only allocates what it needs |

### 7.5 Python API

Already implemented:

```python
import fullmag as fm

fm.engine("fdm")
fm.device("cuda:0")
fm.cell(5e-9, 5e-9, 2e-9)

py = fm.geometry(fm.Box(1e-6, 1e-6, 10e-9), name="py")
py.Ms    = 800e3
py.Aex   = 13e-12
py.alpha = 0.5
py.m     = fm.uniform(1, 0, 0)

co = fm.geometry(fm.Box(1e-6, 1e-6, 5e-9).translate(0, 0, 10e-9), name="co")
co.Ms    = 1400e3
co.Aex   = 30e-12
co.alpha = 0.02
co.m     = fm.uniform(0, 0, 1)

# Future API for explicit coupling:
# fm.coupling(py, co, sigma=1e-3)     # RKKY bilinear
# fm.coupling(py, co, sigma2=-0.5e-3) # biquadratic

fm.save("m", every=50e-12)
fm.relax()
```

Each `fm.geometry()` call → one `FdmMesh` in the engine. The `MagnetHandle` carries all material parameters for that mesh. No global material state. Multi-magnet is first-class.
