use crate::types::StepStats;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum QuantityKind {
    VectorField,
    SpatialScalar,
    GlobalScalar,
}

impl QuantityKind {
    pub const fn as_api_kind(self) -> &'static str {
        match self {
            Self::VectorField => "vector_field",
            Self::SpatialScalar => "spatial_scalar",
            Self::GlobalScalar => "global_scalar",
        }
    }
}

#[derive(Debug, Clone, Copy)]
pub struct QuantitySpec {
    pub id: &'static str,
    pub label: &'static str,
    pub kind: QuantityKind,
    pub unit: &'static str,
    pub interactive_preview: bool,
    pub quick_access_label: Option<&'static str>,
    pub scalar_metric_key: Option<&'static str>,
    pub ui_exposed: bool,
}

const QUANTITY_SPECS: [QuantitySpec; 9] = [
    QuantitySpec {
        id: "m",
        label: "Magnetization",
        kind: QuantityKind::VectorField,
        unit: "dimensionless",
        interactive_preview: true,
        quick_access_label: Some("M"),
        scalar_metric_key: None,
        ui_exposed: true,
    },
    QuantitySpec {
        id: "H_ex",
        label: "Exchange Field",
        kind: QuantityKind::VectorField,
        unit: "A/m",
        interactive_preview: true,
        quick_access_label: Some("H_ex"),
        scalar_metric_key: None,
        ui_exposed: true,
    },
    QuantitySpec {
        id: "H_demag",
        label: "Demagnetization Field",
        kind: QuantityKind::VectorField,
        unit: "A/m",
        interactive_preview: true,
        quick_access_label: Some("H_demag"),
        scalar_metric_key: None,
        ui_exposed: true,
    },
    QuantitySpec {
        id: "H_ext",
        label: "External Field",
        kind: QuantityKind::VectorField,
        unit: "A/m",
        interactive_preview: true,
        quick_access_label: Some("H_ext"),
        scalar_metric_key: None,
        ui_exposed: true,
    },
    QuantitySpec {
        id: "H_eff",
        label: "Effective Field",
        kind: QuantityKind::VectorField,
        unit: "A/m",
        interactive_preview: true,
        quick_access_label: Some("H_eff"),
        scalar_metric_key: None,
        ui_exposed: true,
    },
    QuantitySpec {
        id: "E_ex",
        label: "Exchange Energy",
        kind: QuantityKind::GlobalScalar,
        unit: "J",
        interactive_preview: false,
        quick_access_label: None,
        scalar_metric_key: Some("e_ex"),
        ui_exposed: true,
    },
    QuantitySpec {
        id: "E_demag",
        label: "Demagnetization Energy",
        kind: QuantityKind::GlobalScalar,
        unit: "J",
        interactive_preview: false,
        quick_access_label: None,
        scalar_metric_key: Some("e_demag"),
        ui_exposed: true,
    },
    QuantitySpec {
        id: "E_ext",
        label: "External Energy",
        kind: QuantityKind::GlobalScalar,
        unit: "J",
        interactive_preview: false,
        quick_access_label: None,
        scalar_metric_key: Some("e_ext"),
        ui_exposed: true,
    },
    QuantitySpec {
        id: "E_total",
        label: "Total Energy",
        kind: QuantityKind::GlobalScalar,
        unit: "J",
        interactive_preview: false,
        quick_access_label: None,
        scalar_metric_key: Some("e_total"),
        ui_exposed: true,
    },
];

pub fn quantity_specs() -> &'static [QuantitySpec] {
    &QUANTITY_SPECS
}

pub fn quantity_spec(id: &str) -> Option<&'static QuantitySpec> {
    QUANTITY_SPECS.iter().find(|spec| spec.id == id)
}

pub fn quantity_unit(id: &str) -> &'static str {
    quantity_spec(id).map(|spec| spec.unit).unwrap_or("")
}

pub fn global_scalar_value(id: &str, stats: &StepStats) -> Option<f64> {
    match quantity_spec(id)?.scalar_metric_key? {
        "e_ex" => Some(stats.e_ex),
        "e_demag" => Some(stats.e_demag),
        "e_ext" => Some(stats.e_ext),
        "e_total" => Some(stats.e_total),
        _ => None,
    }
}
