use fullmag_ir::ProblemIR;
use pyo3::exceptions::PyValueError;
use pyo3::prelude::*;

#[pyfunction]
fn validate_ir_json(ir_json: &str) -> PyResult<bool> {
    let ir: ProblemIR =
        serde_json::from_str(ir_json).map_err(|err| PyValueError::new_err(err.to_string()))?;
    ir.validate()
        .map_err(|errors| PyValueError::new_err(errors.join("; ")))?;
    Ok(true)
}

#[pymodule(name = "_fullmag_core")]
fn fullmag_py_core(_py: Python<'_>, module: &Bound<'_, PyModule>) -> PyResult<()> {
    module.add_function(wrap_pyfunction!(validate_ir_json, module)?)?;
    Ok(())
}
