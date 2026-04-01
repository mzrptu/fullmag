use fullmag_ir::{DeclaredUniverseIR, DomainFrameIR, ProblemIR};

pub(crate) const MU0: f64 = 4.0 * std::f64::consts::PI * 1e-7;
pub(crate) const PLACEMENT_TOLERANCE: f64 = 1e-12;
pub(crate) const GRID_TOLERANCE: f64 = 1e-6;

/// Returns `true` when the user requested a CUDA device via `runtime_metadata`.
pub(crate) fn runtime_requests_cuda(problem: &ProblemIR) -> bool {
    problem
        .problem_meta
        .runtime_metadata
        .get("runtime_selection")
        .and_then(|v| v.get("device"))
        .and_then(|v| v.as_str())
        .is_some_and(|d| d == "cuda" || d == "gpu")
}

#[derive(Debug, Clone)]
pub(crate) struct StudyUniverseMetadata {
    pub mode: String,
    pub size: Option<[f64; 3]>,
    pub center: [f64; 3],
    pub padding: [f64; 3],
}

pub(crate) fn json_vec3(value: Option<&serde_json::Value>) -> Option<[f64; 3]> {
    let array = value?.as_array()?;
    if array.len() != 3 {
        return None;
    }
    let mut out = [0.0; 3];
    for (index, component) in array.iter().enumerate() {
        out[index] = component.as_f64()?;
    }
    Some(out)
}

pub(crate) fn study_universe_metadata(problem: &ProblemIR) -> Option<StudyUniverseMetadata> {
    let raw = problem
        .problem_meta
        .runtime_metadata
        .get("study_universe")?;
    let object = raw.as_object()?;
    Some(StudyUniverseMetadata {
        mode: object
            .get("mode")
            .and_then(|value| value.as_str())
            .unwrap_or("auto")
            .to_string(),
        size: json_vec3(object.get("size")),
        center: json_vec3(object.get("center")).unwrap_or([0.0, 0.0, 0.0]),
        padding: json_vec3(object.get("padding")).unwrap_or([0.0, 0.0, 0.0]),
    })
}

pub(crate) fn problem_domain_frame(problem: &ProblemIR) -> Option<DomainFrameIR> {
    if let Some(raw) = problem.problem_meta.runtime_metadata.get("domain_frame") {
        if let Ok(frame) = serde_json::from_value::<DomainFrameIR>(raw.clone()) {
            return frame.finalized();
        }
    }

    problem
        .problem_meta
        .runtime_metadata
        .get("study_universe")
        .and_then(DeclaredUniverseIR::from_study_universe_value)
        .map(|declared_universe| DomainFrameIR {
            declared_universe: Some(declared_universe),
            ..DomainFrameIR::default()
        })
        .and_then(DomainFrameIR::finalized)
}

/// Generate deterministic random unit vectors from a seed.
pub fn generate_random_unit_vectors(seed: u64, count: usize) -> Vec<[f64; 3]> {
    // Simple xorshift64-based PRNG for deterministic random unit vectors.
    let mut state = seed;
    let mut vectors = Vec::with_capacity(count);

    for _ in 0..count {
        // Generate 3 random f64 in [-1, 1]
        let mut components = [0.0f64; 3];
        loop {
            for c in &mut components {
                state ^= state << 13;
                state ^= state >> 7;
                state ^= state << 17;
                *c = (state as f64 / u64::MAX as f64) * 2.0 - 1.0;
            }
            let norm = (components[0] * components[0]
                + components[1] * components[1]
                + components[2] * components[2])
                .sqrt();
            if norm > 1e-10 {
                components[0] /= norm;
                components[1] /= norm;
                components[2] /= norm;
                break;
            }
        }
        vectors.push(components);
    }
    vectors
}
