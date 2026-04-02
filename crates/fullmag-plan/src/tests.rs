use super::*;

#[test]
fn mesh_parts_from_shared_domain_produces_air_and_magnetic() {
    let mesh = MeshIR {
        mesh_name: "shared".to_string(),
        nodes: vec![
            [0.0, 0.0, 0.0],
            [1.0, 0.0, 0.0],
            [0.0, 1.0, 0.0],
            [0.0, 0.0, 1.0],
            [2.0, 0.0, 0.0],
            [2.0, 1.0, 0.0],
            [2.0, 0.0, 1.0],
            [3.0, 0.0, 0.0],
        ],
        elements: vec![[0, 1, 2, 3], [4, 5, 6, 7]],
        element_markers: vec![1, 0],
        boundary_faces: vec![[0, 1, 2], [4, 5, 6]],
        boundary_markers: vec![1, 99],
    };
    let object_segments = vec![
        fullmag_ir::FemObjectSegmentIR {
            object_id: "flower".to_string(),
            geometry_id: Some("flower_geom".to_string()),
            node_start: 0,
            node_count: 4,
            element_start: 0,
            element_count: 1,
            boundary_face_start: 0,
            boundary_face_count: 1,
        },
        fullmag_ir::FemObjectSegmentIR {
            object_id: crate::mesh::AIR_OBJECT_SEGMENT_ID.to_string(),
            geometry_id: None,
            node_start: 4,
            node_count: 4,
            element_start: 1,
            element_count: 1,
            boundary_face_start: 1,
            boundary_face_count: 1,
        },
    ];

    let parts = crate::mesh::build_mesh_parts_from_segments(
        &mesh,
        &object_segments,
        fullmag_ir::FemDomainMeshModeIR::SharedDomainMeshWithAir,
    );

    assert_eq!(parts.len(), 2);
    assert_eq!(parts[0].role, fullmag_ir::FemMeshPartRole::MagneticObject);
    assert_eq!(parts[0].object_id.as_deref(), Some("flower"));
    assert_eq!(parts[1].role, fullmag_ir::FemMeshPartRole::Air);
    assert_eq!(parts[1].object_id, None);
}

#[test]
fn mesh_parts_from_merged_magnetic_has_no_air() {
    let mesh = MeshIR {
        mesh_name: "merged".to_string(),
        nodes: vec![
            [0.0, 0.0, 0.0],
            [1.0, 0.0, 0.0],
            [0.0, 1.0, 0.0],
            [0.0, 0.0, 1.0],
        ],
        elements: vec![[0, 1, 2, 3]],
        element_markers: vec![1],
        boundary_faces: vec![[0, 1, 2]],
        boundary_markers: vec![1],
    };
    let object_segments = vec![fullmag_ir::FemObjectSegmentIR {
        object_id: "flower".to_string(),
        geometry_id: Some("flower_geom".to_string()),
        node_start: 0,
        node_count: 4,
        element_start: 0,
        element_count: 1,
        boundary_face_start: 0,
        boundary_face_count: 1,
    }];

    let parts = crate::mesh::build_mesh_parts_from_segments(
        &mesh,
        &object_segments,
        fullmag_ir::FemDomainMeshModeIR::MergedMagneticMesh,
    );

    assert_eq!(parts.len(), 1);
    assert_eq!(parts[0].role, fullmag_ir::FemMeshPartRole::MagneticObject);
    assert!(parts
        .iter()
        .all(|part| part.role != fullmag_ir::FemMeshPartRole::Air));
}

#[test]
fn mesh_parts_bounds_are_correct() {
    let mesh = MeshIR {
        mesh_name: "bounds".to_string(),
        nodes: vec![
            [-1.0, 2.0, 3.0],
            [4.0, -5.0, 6.0],
            [0.5, 1.5, -2.5],
            [9.0, 9.0, 9.0],
        ],
        elements: vec![[0, 1, 2, 3]],
        element_markers: vec![1],
        boundary_faces: vec![[0, 1, 2]],
        boundary_markers: vec![1],
    };
    let object_segments = vec![fullmag_ir::FemObjectSegmentIR {
        object_id: "sample".to_string(),
        geometry_id: Some("sample_geom".to_string()),
        node_start: 0,
        node_count: 3,
        element_start: 0,
        element_count: 1,
        boundary_face_start: 0,
        boundary_face_count: 1,
    }];

    let parts = crate::mesh::build_mesh_parts_from_segments(
        &mesh,
        &object_segments,
        fullmag_ir::FemDomainMeshModeIR::MergedMagneticMesh,
    );

    assert_eq!(parts[0].bounds_min, Some([-1.0, -5.0, -2.5]));
    assert_eq!(parts[0].bounds_max, Some([4.0, 2.0, 6.0]));
}

#[test]
fn analyze_detects_interface_between_touching_markers() {
    let mesh = MeshIR {
        mesh_name: "touching".to_string(),
        nodes: vec![
            [0.0, 0.0, 0.0],
            [1.0, 0.0, 0.0],
            [0.0, 1.0, 0.0],
            [0.0, 0.0, 1.0],
            [0.0, 0.0, -1.0],
        ],
        elements: vec![[0, 1, 2, 3], [0, 1, 2, 4]],
        element_markers: vec![1, 2],
        boundary_faces: vec![[0, 1, 3], [0, 1, 4]],
        boundary_markers: vec![10, 20],
    };
    let analysis = crate::mesh::analyze_shared_domain_mesh(
        &mesh,
        &[
            fullmag_ir::FemDomainRegionMarkerIR {
                geometry_name: "left".to_string(),
                marker: 1,
            },
            fullmag_ir::FemDomainRegionMarkerIR {
                geometry_name: "right".to_string(),
                marker: 2,
            },
        ],
    )
    .expect("analysis should succeed for touching markers");

    assert_eq!(
        analysis.ordered_regions,
        vec![("left".to_string(), 1), ("right".to_string(), 2)]
    );
    assert_eq!(analysis.shared_interface_nodes.len(), 3);
    assert!(analysis
        .shared_interface_nodes
        .iter()
        .all(|(_node, owners)| owners == &vec![1, 2]));
}

#[test]
fn analyze_classifies_air_nodes() {
    let mesh = MeshIR {
        mesh_name: "air".to_string(),
        nodes: vec![
            [0.0, 0.0, 0.0],
            [1.0, 0.0, 0.0],
            [0.0, 1.0, 0.0],
            [0.0, 0.0, 1.0],
            [3.0, 0.0, 0.0],
            [4.0, 0.0, 0.0],
            [3.0, 1.0, 0.0],
            [3.0, 0.0, 1.0],
        ],
        elements: vec![[0, 1, 2, 3], [4, 5, 6, 7]],
        element_markers: vec![1, 0],
        boundary_faces: vec![[0, 1, 2], [4, 5, 6]],
        boundary_markers: vec![10, 99],
    };
    let analysis = crate::mesh::analyze_shared_domain_mesh(
        &mesh,
        &[fullmag_ir::FemDomainRegionMarkerIR {
            geometry_name: "flower".to_string(),
            marker: 1,
        }],
    )
    .expect("analysis should succeed");

    assert_eq!(&analysis.node_owner[..4], &[1, 1, 1, 1]);
    assert_eq!(&analysis.node_owner[4..], &[0, 0, 0, 0]);
}

#[test]
fn validate_rejects_shared_nodes_for_now() {
    let mesh = MeshIR {
        mesh_name: "touching".to_string(),
        nodes: vec![
            [0.0, 0.0, 0.0],
            [1.0, 0.0, 0.0],
            [0.0, 1.0, 0.0],
            [0.0, 0.0, 1.0],
            [0.0, 0.0, -1.0],
        ],
        elements: vec![[0, 1, 2, 3], [0, 1, 2, 4]],
        element_markers: vec![1, 2],
        boundary_faces: vec![[0, 1, 3], [0, 1, 4]],
        boundary_markers: vec![10, 20],
    };
    let analysis = crate::mesh::analyze_shared_domain_mesh(
        &mesh,
        &[
            fullmag_ir::FemDomainRegionMarkerIR {
                geometry_name: "left".to_string(),
                marker: 1,
            },
            fullmag_ir::FemDomainRegionMarkerIR {
                geometry_name: "right".to_string(),
                marker: 2,
            },
        ],
    )
    .expect("analysis should succeed");

    let error = crate::mesh::validate_packing_constraints(&analysis, &mesh.mesh_name, false)
        .expect_err("shared nodes should still be rejected");
    assert!(error.contains("disjoint node ownership"));
}

#[test]
fn validate_accepts_shared_nodes_when_solver_supports_conformal() {
    let mesh = MeshIR {
        mesh_name: "touching".to_string(),
        nodes: vec![
            [0.0, 0.0, 0.0],
            [1.0, 0.0, 0.0],
            [0.0, 1.0, 0.0],
            [0.0, 0.0, 1.0],
            [0.0, 0.0, -1.0],
        ],
        elements: vec![[0, 1, 2, 3], [0, 1, 2, 4]],
        element_markers: vec![1, 2],
        boundary_faces: vec![[0, 1, 3], [0, 1, 4]],
        boundary_markers: vec![10, 20],
    };
    let analysis = crate::mesh::analyze_shared_domain_mesh(
        &mesh,
        &[
            fullmag_ir::FemDomainRegionMarkerIR {
                geometry_name: "left".to_string(),
                marker: 1,
            },
            fullmag_ir::FemDomainRegionMarkerIR {
                geometry_name: "right".to_string(),
                marker: 2,
            },
        ],
    )
    .expect("analysis should succeed");

    crate::mesh::validate_packing_constraints(&analysis, &mesh.mesh_name, true)
        .expect("conformal-native path should accept shared interface nodes");
}

#[test]
fn pack_duplicates_shared_interface_nodes_per_region() {
    let mesh = MeshIR {
        mesh_name: "touching".to_string(),
        nodes: vec![
            [0.0, 0.0, 0.0],
            [1.0, 0.0, 0.0],
            [0.0, 1.0, 0.0],
            [0.0, 0.0, 1.0],
            [0.0, 0.0, -1.0],
        ],
        elements: vec![[0, 1, 2, 3], [0, 1, 2, 4]],
        element_markers: vec![1, 2],
        boundary_faces: vec![[0, 1, 3], [0, 1, 4]],
        boundary_markers: vec![10, 20],
    };
    let region_markers = vec![
        fullmag_ir::FemDomainRegionMarkerIR {
            geometry_name: "left".to_string(),
            marker: 1,
        },
        fullmag_ir::FemDomainRegionMarkerIR {
            geometry_name: "right".to_string(),
            marker: 2,
        },
    ];
    let analysis = crate::mesh::analyze_shared_domain_mesh(&mesh, &region_markers)
        .expect("analysis should succeed");

    let (packed, segments) = crate::mesh::pack_mesh_by_analysis(&mesh, &analysis)
        .expect("packing should duplicate shared interface nodes");

    assert_eq!(packed.nodes.len(), 8);
    assert_eq!(packed.elements, vec![[0, 1, 2, 3], [4, 5, 6, 7]]);
    assert_eq!(segments.len(), 2);
    assert_eq!(segments[0].object_id, "left");
    assert_eq!(segments[0].node_count, 4);
    assert_eq!(segments[1].object_id, "right");
    assert_eq!(segments[1].node_count, 4);
    assert_eq!(packed.nodes[0], packed.nodes[4]);
    assert_eq!(packed.nodes[1], packed.nodes[5]);
    assert_eq!(packed.nodes[2], packed.nodes[6]);
}

#[test]
fn pack_produces_same_result_as_before() {
    let mesh = MeshIR {
        mesh_name: "shared_ok".to_string(),
        nodes: vec![
            [0.0, 0.0, 0.0],
            [1.0, 0.0, 0.0],
            [0.0, 1.0, 0.0],
            [0.0, 0.0, 1.0],
            [3.0, 0.0, 0.0],
            [4.0, 0.0, 0.0],
            [3.0, 1.0, 0.0],
            [3.0, 0.0, 1.0],
            [8.0, 0.0, 0.0],
            [9.0, 0.0, 0.0],
            [8.0, 1.0, 0.0],
            [8.0, 0.0, 1.0],
        ],
        elements: vec![[0, 1, 2, 3], [4, 5, 6, 7], [8, 9, 10, 11]],
        element_markers: vec![1, 2, 0],
        boundary_faces: vec![[0, 1, 2], [4, 5, 6], [8, 9, 10]],
        boundary_markers: vec![10, 20, 99],
    };
    let region_markers = vec![
        fullmag_ir::FemDomainRegionMarkerIR {
            geometry_name: "left".to_string(),
            marker: 1,
        },
        fullmag_ir::FemDomainRegionMarkerIR {
            geometry_name: "right".to_string(),
            marker: 2,
        },
    ];

    let analysis = crate::mesh::analyze_shared_domain_mesh(&mesh, &region_markers)
        .expect("analysis should succeed");
    crate::mesh::validate_packing_constraints(&analysis, &mesh.mesh_name, false)
        .expect("disjoint mesh should validate");
    let packed_via_analysis = crate::mesh::pack_mesh_by_analysis(&mesh, &analysis)
        .expect("packing via analysis should succeed");
    let packed_via_public = crate::mesh::reorder_shared_domain_mesh(&mesh, &region_markers, false)
        .expect("public reorder should succeed");

    assert_eq!(packed_via_analysis, packed_via_public);
}

#[test]
fn bootstrap_example_plans_successfully() {
    let ir = ProblemIR::bootstrap_example();
    let plan = plan(&ir).expect("bootstrap example should plan successfully");

    match &plan.backend_plan {
        BackendPlanIR::Fdm(fdm) => {
            // Box(200e-9, 20e-9, 6e-9) with cell(2e-9, 2e-9, 2e-9)
            assert_eq!(fdm.grid.cells, [100, 10, 3]);
            assert_eq!(fdm.cell_size, [2e-9, 2e-9, 2e-9]);
            assert_eq!(fdm.material.name, "Py");
            assert_eq!(fdm.material.exchange_stiffness, 13e-12);
            assert_eq!(fdm.gyromagnetic_ratio, 2.211e5);
            assert_eq!(fdm.precision, ExecutionPrecision::Double);
            assert_eq!(fdm.initial_magnetization.len(), (100 * 10 * 3) as usize);
        }
        _ => panic!("expected FDM plan"),
    }
}

#[test]
fn unsupported_term_is_rejected() {
    let mut ir = ProblemIR::bootstrap_example();
    ir.energy_terms = vec![fullmag_ir::EnergyTermIR::InterfacialDmi { d: 3e-3 }];

    let err = plan(&ir).expect_err("DMI should be rejected");
    assert!(err.reasons.iter().any(|r| r.contains("semantic-only")));
}

#[test]
fn imported_geometry_without_grid_asset_is_rejected() {
    let mut ir = ProblemIR::bootstrap_example();
    ir.geometry.entries = vec![GeometryEntryIR::ImportedGeometry {
        name: "mesh".to_string(),
        source: "sample.step".to_string(),
        format: "step".to_string(),
        scale: fullmag_ir::ImportedGeometryScaleIR::Uniform(1.0),
    }];
    ir.regions[0].geometry = "mesh".to_string();

    let err = plan(&ir).expect_err("imported geometry should be rejected");
    assert!(err
        .reasons
        .iter()
        .any(|r| r.contains("requires a precomputed FDM grid asset")));
}

#[test]
fn imported_geometry_with_grid_asset_plans_successfully() {
    let mut ir = ProblemIR::bootstrap_example();
    ir.geometry.entries = vec![GeometryEntryIR::ImportedGeometry {
        name: "mesh".to_string(),
        source: "sample.stl".to_string(),
        format: "stl".to_string(),
        scale: fullmag_ir::ImportedGeometryScaleIR::Uniform(1.0),
    }];
    ir.regions[0].geometry = "mesh".to_string();
    ir.geometry_assets = Some(fullmag_ir::GeometryAssetsIR {
        fdm_grid_assets: vec![fullmag_ir::FdmGridAssetIR {
            geometry_name: "mesh".to_string(),
            cells: [4, 2, 1],
            cell_size: [2e-9, 2e-9, 2e-9],
            origin: [-4e-9, -2e-9, -1e-9],
            active_mask: vec![true, true, true, true, false, false, false, false],
        }],
        fem_mesh_assets: vec![],
        fem_domain_mesh_asset: None,
    });

    let plan = plan(&ir).expect("imported geometry with grid asset should plan");
    match plan.backend_plan {
        BackendPlanIR::Fdm(fdm) => {
            assert_eq!(fdm.grid.cells, [4, 2, 1]);
            assert_eq!(fdm.active_mask.unwrap().len(), 8);
        }
        _ => panic!("expected FDM plan"),
    }
}

#[test]
fn fem_backend_with_mesh_asset_plans_successfully() {
    let mut ir = ProblemIR::bootstrap_example();
    ir.backend_policy.requested_backend = BackendTarget::Fem;
    ir.backend_policy.discretization_hints = Some(fullmag_ir::DiscretizationHintsIR {
        fdm: Some(fullmag_ir::FdmHintsIR {
            cell: [2e-9, 2e-9, 5e-9],
            default_cell: None,
            per_magnet: None,
            demag: None,
            boundary_correction: None,
        }),
        fem: Some(fullmag_ir::FemHintsIR {
            order: 1,
            hmax: 2e-9,
            mesh: Some("meshes/unit_tet.msh".to_string()),
        }),
        hybrid: None,
    });
    ir.geometry_assets = Some(fullmag_ir::GeometryAssetsIR {
        fdm_grid_assets: vec![],
        fem_mesh_assets: vec![fullmag_ir::FemMeshAssetIR {
            geometry_name: "strip".to_string(),
            mesh_source: Some("meshes/unit_tet.msh".to_string()),
            mesh: Some(fullmag_ir::MeshIR {
                mesh_name: "strip".to_string(),
                nodes: vec![
                    [0.0, 0.0, 0.0],
                    [1.0, 0.0, 0.0],
                    [0.0, 1.0, 0.0],
                    [0.0, 0.0, 1.0],
                ],
                elements: vec![[0, 1, 2, 3]],
                element_markers: vec![1],
                boundary_faces: vec![[0, 1, 2]],
                boundary_markers: vec![1],
            }),
        }],
        fem_domain_mesh_asset: None,
    });

    let plan = plan(&ir).expect("FEM mesh asset should produce a FemPlanIR");
    match plan.backend_plan {
        BackendPlanIR::Fem(fem) => {
            assert_eq!(fem.mesh.mesh_name, "strip");
            assert_eq!(fem.material.name, "Py");
            assert_eq!(fem.initial_magnetization.len(), 4);
            assert!(fem.enable_exchange);
            assert!(!fem.enable_demag);
            assert_eq!(fem.mesh_parts.len(), 1);
            assert_eq!(
                fem.mesh_parts[0].role,
                fullmag_ir::FemMeshPartRole::MagneticObject
            );
            assert_eq!(fem.mesh_parts[0].material_id.as_deref(), Some("Py"));
        }
        _ => panic!("expected FEM plan"),
    }
}

#[test]
fn fem_plan_serializes_mesh_parts() {
    let mut ir = ProblemIR::bootstrap_example();
    ir.backend_policy.requested_backend = BackendTarget::Fem;
    ir.backend_policy.discretization_hints = Some(fullmag_ir::DiscretizationHintsIR {
        fdm: Some(fullmag_ir::FdmHintsIR {
            cell: [2e-9, 2e-9, 5e-9],
            default_cell: None,
            per_magnet: None,
            demag: None,
            boundary_correction: None,
        }),
        fem: Some(fullmag_ir::FemHintsIR {
            order: 1,
            hmax: 2e-9,
            mesh: Some("meshes/unit_tet.msh".to_string()),
        }),
        hybrid: None,
    });
    ir.geometry_assets = Some(fullmag_ir::GeometryAssetsIR {
        fdm_grid_assets: vec![],
        fem_mesh_assets: vec![fullmag_ir::FemMeshAssetIR {
            geometry_name: "strip".to_string(),
            mesh_source: Some("meshes/unit_tet.msh".to_string()),
            mesh: Some(fullmag_ir::MeshIR {
                mesh_name: "strip".to_string(),
                nodes: vec![
                    [0.0, 0.0, 0.0],
                    [1.0, 0.0, 0.0],
                    [0.0, 1.0, 0.0],
                    [0.0, 0.0, 1.0],
                ],
                elements: vec![[0, 1, 2, 3]],
                element_markers: vec![1],
                boundary_faces: vec![[0, 1, 2]],
                boundary_markers: vec![1],
            }),
        }],
        fem_domain_mesh_asset: None,
    });

    let plan = plan(&ir).expect("FEM mesh asset should produce a FemPlanIR");
    let json =
        serde_json::to_value(&plan).expect("execution plan with mesh_parts should serialize");
    let mesh_parts = json
        .get("backend_plan")
        .and_then(|value| value.get("mesh_parts"))
        .and_then(serde_json::Value::as_array)
        .expect("FemPlanIR JSON should include mesh_parts");
    assert!(!mesh_parts.is_empty());
}

#[test]
fn fem_backend_with_air_elements_lowers_study_universe_to_air_box_config() {
    let mut ir = ProblemIR::bootstrap_example();
    ir.backend_policy.requested_backend = BackendTarget::Fem;
    ir.problem_meta.runtime_metadata.insert(
        "study_universe".to_string(),
        serde_json::json!({
            "mode": "manual",
            "size": [8.0, 6.0, 4.0],
            "center": [0.5, 0.25, -0.125],
        }),
    );
    ir.energy_terms = vec![
        fullmag_ir::EnergyTermIR::Exchange,
        fullmag_ir::EnergyTermIR::Demag { realization: None },
    ];
    ir.backend_policy.discretization_hints = Some(fullmag_ir::DiscretizationHintsIR {
        fdm: Some(fullmag_ir::FdmHintsIR {
            cell: [2e-9, 2e-9, 5e-9],
            default_cell: None,
            per_magnet: None,
            demag: None,
            boundary_correction: None,
        }),
        fem: Some(fullmag_ir::FemHintsIR {
            order: 1,
            hmax: 2e-9,
            mesh: None,
        }),
        hybrid: None,
    });
    ir.geometry_assets = Some(fullmag_ir::GeometryAssetsIR {
        fdm_grid_assets: vec![],
        fem_mesh_assets: vec![fullmag_ir::FemMeshAssetIR {
            geometry_name: "strip".to_string(),
            mesh_source: None,
            mesh: Some(fullmag_ir::MeshIR {
                mesh_name: "strip".to_string(),
                nodes: vec![
                    [0.0, 0.0, 0.0],
                    [1.0, 0.0, 0.0],
                    [0.0, 1.0, 0.0],
                    [0.0, 0.0, 1.0],
                    [-2.0, -2.0, -2.0],
                    [2.0, -2.0, -2.0],
                    [-2.0, 2.0, -2.0],
                    [-2.0, -2.0, 2.0],
                ],
                elements: vec![[0, 1, 2, 3], [4, 5, 6, 7]],
                element_markers: vec![1, 0],
                boundary_faces: vec![[0, 1, 2], [4, 5, 6]],
                boundary_markers: vec![1, 99],
            }),
        }],
        fem_domain_mesh_asset: None,
    });

    let plan = plan(&ir).expect("FEM air-box mesh asset should produce an air-box config");
    match plan.backend_plan {
        BackendPlanIR::Fem(fem) => {
            assert_eq!(fem.demag_realization.as_deref(), Some("poisson_airbox"));
            let air_box = fem
                .air_box_config
                .expect("air elements should lower to an executable air-box config");
            assert_eq!(air_box.boundary_marker, 99);
            assert_eq!(air_box.bc_kind.as_deref(), Some("dirichlet"));
            assert_eq!(air_box.shape.as_deref(), Some("bbox"));
            assert!((air_box.factor - 8.0).abs() < 1e-12);
        }
        _ => panic!("expected FEM plan"),
    }
    assert!(plan
        .provenance
        .notes
        .iter()
        .any(|note| note.contains("study_universe lowered to FEM air-box configuration")));
}

#[test]
fn fem_backend_without_air_elements_keeps_universe_as_provenance_note() {
    let mut ir = ProblemIR::bootstrap_example();
    ir.backend_policy.requested_backend = BackendTarget::Fem;
    ir.problem_meta.runtime_metadata.insert(
        "study_universe".to_string(),
        serde_json::json!({
            "mode": "manual",
            "size": [8.0, 6.0, 4.0],
            "center": [0.0, 0.0, 0.0],
        }),
    );
    ir.energy_terms = vec![
        fullmag_ir::EnergyTermIR::Exchange,
        fullmag_ir::EnergyTermIR::Demag { realization: None },
    ];
    ir.backend_policy.discretization_hints = Some(fullmag_ir::DiscretizationHintsIR {
        fdm: Some(fullmag_ir::FdmHintsIR {
            cell: [2e-9, 2e-9, 5e-9],
            default_cell: None,
            per_magnet: None,
            demag: None,
            boundary_correction: None,
        }),
        fem: Some(fullmag_ir::FemHintsIR {
            order: 1,
            hmax: 2e-9,
            mesh: None,
        }),
        hybrid: None,
    });
    ir.geometry_assets = Some(fullmag_ir::GeometryAssetsIR {
        fdm_grid_assets: vec![],
        fem_mesh_assets: vec![fullmag_ir::FemMeshAssetIR {
            geometry_name: "strip".to_string(),
            mesh_source: None,
            mesh: Some(fullmag_ir::MeshIR {
                mesh_name: "strip".to_string(),
                nodes: vec![
                    [0.0, 0.0, 0.0],
                    [1.0, 0.0, 0.0],
                    [0.0, 1.0, 0.0],
                    [0.0, 0.0, 1.0],
                ],
                elements: vec![[0, 1, 2, 3]],
                element_markers: vec![1],
                boundary_faces: vec![[0, 1, 2]],
                boundary_markers: vec![1],
            }),
        }],
        fem_domain_mesh_asset: None,
    });

    let plan = plan(&ir).expect("FEM mesh without air elements should still plan");
    match plan.backend_plan {
        BackendPlanIR::Fem(fem) => {
            assert_eq!(fem.demag_realization.as_deref(), Some("transfer_grid"));
            assert!(fem.air_box_config.is_none());
        }
        _ => panic!("expected FEM plan"),
    }
    assert!(plan.provenance.notes.iter().any(|note| {
        note.contains("study_universe metadata present")
            && note.contains("selected FEM mesh has no air elements")
    }));
}

#[test]
fn fem_backend_populates_domain_frame_and_domain_mesh_mode() {
    let mut ir = ProblemIR::bootstrap_example();
    ir.backend_policy.requested_backend = BackendTarget::Fem;
    ir.problem_meta.runtime_metadata.insert(
        "domain_frame".to_string(),
        serde_json::json!({
            "declared_universe": {
                "mode": "manual",
                "size": [8.0, 6.0, 4.0],
                "center": [0.5, 0.25, -0.125],
            },
            "object_bounds_min": [0.0, 0.0, 0.0],
            "object_bounds_max": [1.0, 1.0, 1.0],
            "effective_extent": [8.0, 6.0, 4.0],
            "effective_center": [0.5, 0.25, -0.125],
            "effective_source": "declared_universe_manual",
        }),
    );
    ir.backend_policy.discretization_hints = Some(fullmag_ir::DiscretizationHintsIR {
        fdm: Some(fullmag_ir::FdmHintsIR {
            cell: [2e-9, 2e-9, 5e-9],
            default_cell: None,
            per_magnet: None,
            demag: None,
            boundary_correction: None,
        }),
        fem: Some(fullmag_ir::FemHintsIR {
            order: 1,
            hmax: 2e-9,
            mesh: None,
        }),
        hybrid: None,
    });
    ir.geometry_assets = Some(fullmag_ir::GeometryAssetsIR {
        fdm_grid_assets: vec![],
        fem_mesh_assets: vec![fullmag_ir::FemMeshAssetIR {
            geometry_name: "strip".to_string(),
            mesh_source: None,
            mesh: Some(fullmag_ir::MeshIR {
                mesh_name: "strip".to_string(),
                nodes: vec![
                    [0.0, 0.0, 0.0],
                    [1.0, 0.0, 0.0],
                    [0.0, 1.0, 0.0],
                    [0.0, 0.0, 1.0],
                ],
                elements: vec![[0, 1, 2, 3]],
                element_markers: vec![1],
                boundary_faces: vec![[0, 1, 2]],
                boundary_markers: vec![1],
            }),
        }],
        fem_domain_mesh_asset: None,
    });

    let plan = plan(&ir).expect("FEM plan should populate domain_frame");
    match plan.backend_plan {
        BackendPlanIR::Fem(fem) => {
            assert_eq!(
                fem.domain_mesh_mode,
                fullmag_ir::FemDomainMeshModeIR::MergedMagneticMesh
            );
            let domain_frame = fem
                .domain_frame
                .expect("domain_frame should be carried into FemPlanIR");
            assert_eq!(
                domain_frame.effective_source.as_deref(),
                Some("declared_universe_manual")
            );
            assert_eq!(domain_frame.effective_extent, Some([8.0, 6.0, 4.0]));
            assert_eq!(domain_frame.mesh_bounds_min, Some([0.0, 0.0, 0.0]));
            assert_eq!(domain_frame.mesh_bounds_max, Some([1.0, 1.0, 1.0]));
        }
        _ => panic!("expected FEM plan"),
    }
}

#[test]
fn fem_backend_prefers_domain_frame_declared_universe_over_legacy_study_universe() {
    let mut ir = ProblemIR::bootstrap_example();
    ir.backend_policy.requested_backend = BackendTarget::Fem;
    ir.problem_meta.runtime_metadata.insert(
        "domain_frame".to_string(),
        serde_json::json!({
            "declared_universe": {
                "mode": "manual",
                "size": [9.0, 7.0, 5.0],
                "center": [1.0, 2.0, 3.0],
                "airbox_hmax": 7.5,
            },
            "object_bounds_min": [0.0, 0.0, 0.0],
            "object_bounds_max": [1.0, 1.0, 1.0],
            "effective_extent": [9.0, 7.0, 5.0],
            "effective_center": [1.0, 2.0, 3.0],
            "effective_source": "declared_universe_manual",
        }),
    );
    ir.problem_meta.runtime_metadata.insert(
        "study_universe".to_string(),
        serde_json::json!({
            "mode": "manual",
            "size": [99.0, 99.0, 99.0],
            "center": [0.0, 0.0, 0.0],
            "airbox_hmax": 0.5,
        }),
    );
    ir.backend_policy.discretization_hints = Some(fullmag_ir::DiscretizationHintsIR {
        fdm: Some(fullmag_ir::FdmHintsIR {
            cell: [2e-9, 2e-9, 5e-9],
            default_cell: None,
            per_magnet: None,
            demag: None,
            boundary_correction: None,
        }),
        fem: Some(fullmag_ir::FemHintsIR {
            order: 1,
            hmax: 2e-9,
            mesh: None,
        }),
        hybrid: None,
    });
    ir.geometry_assets = Some(fullmag_ir::GeometryAssetsIR {
        fdm_grid_assets: vec![],
        fem_mesh_assets: vec![fullmag_ir::FemMeshAssetIR {
            geometry_name: "strip".to_string(),
            mesh_source: None,
            mesh: Some(fullmag_ir::MeshIR {
                mesh_name: "strip".to_string(),
                nodes: vec![
                    [0.0, 0.0, 0.0],
                    [1.0, 0.0, 0.0],
                    [0.0, 1.0, 0.0],
                    [0.0, 0.0, 1.0],
                ],
                elements: vec![[0, 1, 2, 3]],
                element_markers: vec![1],
                boundary_faces: vec![[0, 1, 2]],
                boundary_markers: vec![1],
            }),
        }],
        fem_domain_mesh_asset: None,
    });

    let plan = plan(&ir).expect("FEM plan should respect declared_universe from domain_frame");
    match plan.backend_plan {
        BackendPlanIR::Fem(fem) => {
            let domain_frame = fem
                .domain_frame
                .expect("domain_frame should be carried into FemPlanIR");
            let declared_universe = domain_frame
                .declared_universe
                .expect("declared_universe should be preserved");
            assert_eq!(declared_universe.size, Some([9.0, 7.0, 5.0]));
            assert_eq!(declared_universe.center, Some([1.0, 2.0, 3.0]));
            assert_eq!(declared_universe.airbox_hmax, Some(7.5));
        }
        _ => panic!("expected FEM plan"),
    }
}

#[test]
fn fem_backend_with_mesh_source_json_plans_successfully() {
    let mesh_path = std::env::temp_dir().join(format!(
        "fullmag-plan-test-mesh-{}.json",
        std::process::id()
    ));
    let mesh_json = serde_json::json!({
        "mesh_name": "strip",
        "nodes": [
            [0.0, 0.0, 0.0],
            [1.0, 0.0, 0.0],
            [0.0, 1.0, 0.0],
            [0.0, 0.0, 1.0]
        ],
        "elements": [[0, 1, 2, 3]],
        "element_markers": [1],
        "boundary_faces": [[0, 1, 2]],
        "boundary_markers": [1]
    });
    std::fs::write(&mesh_path, serde_json::to_string(&mesh_json).unwrap()).unwrap();

    let mut ir = ProblemIR::bootstrap_example();
    ir.backend_policy.requested_backend = BackendTarget::Fem;
    ir.backend_policy.discretization_hints = Some(fullmag_ir::DiscretizationHintsIR {
        fdm: Some(fullmag_ir::FdmHintsIR {
            cell: [2e-9, 2e-9, 5e-9],
            default_cell: None,
            per_magnet: None,
            demag: None,
            boundary_correction: None,
        }),
        fem: Some(fullmag_ir::FemHintsIR {
            order: 1,
            hmax: 2e-9,
            mesh: Some(mesh_path.display().to_string()),
        }),
        hybrid: None,
    });
    ir.geometry_assets = Some(fullmag_ir::GeometryAssetsIR {
        fdm_grid_assets: vec![],
        fem_mesh_assets: vec![fullmag_ir::FemMeshAssetIR {
            geometry_name: "strip".to_string(),
            mesh_source: Some(mesh_path.display().to_string()),
            mesh: None,
        }],
        fem_domain_mesh_asset: None,
    });

    let plan = plan(&ir).expect("FEM mesh_source JSON should produce a FemPlanIR");
    match plan.backend_plan {
        BackendPlanIR::Fem(fem) => {
            assert_eq!(fem.mesh.mesh_name, "strip");
            assert_eq!(fem.mesh.nodes.len(), 4);
            assert_eq!(fem.mesh.elements.len(), 1);
        }
        _ => panic!("expected FEM plan"),
    }

    let _ = std::fs::remove_file(mesh_path);
}

#[test]
fn fem_backend_multibody_merges_disjoint_mesh_assets() {
    let mut ir = ProblemIR::bootstrap_example();
    ir.backend_policy.requested_backend = BackendTarget::Fem;
    ir.backend_policy.discretization_hints = Some(fullmag_ir::DiscretizationHintsIR {
        fdm: Some(fullmag_ir::FdmHintsIR {
            cell: [2e-9, 2e-9, 2e-9],
            default_cell: None,
            per_magnet: None,
            demag: None,
            boundary_correction: None,
        }),
        fem: Some(fullmag_ir::FemHintsIR {
            order: 1,
            hmax: 2e-9,
            mesh: None,
        }),
        hybrid: None,
    });
    ir.geometry.entries = vec![
        GeometryEntryIR::Box {
            name: "free_geom".to_string(),
            size: [2.0, 1.0, 1.0],
        },
        GeometryEntryIR::Box {
            name: "ref_geom".to_string(),
            size: [2.0, 1.0, 1.0],
        },
    ];
    ir.regions = vec![
        fullmag_ir::RegionIR {
            name: "free".to_string(),
            geometry: "free_geom".to_string(),
        },
        fullmag_ir::RegionIR {
            name: "ref".to_string(),
            geometry: "ref_geom".to_string(),
        },
    ];
    ir.magnets = vec![
        fullmag_ir::MagnetIR {
            name: "free".to_string(),
            region: "free".to_string(),
            material: "Py".to_string(),
            initial_magnetization: Some(InitialMagnetizationIR::Uniform {
                value: [1.0, 0.0, 0.0],
            }),
        },
        fullmag_ir::MagnetIR {
            name: "ref".to_string(),
            region: "ref".to_string(),
            material: "Py".to_string(),
            initial_magnetization: Some(InitialMagnetizationIR::Uniform {
                value: [0.0, 1.0, 0.0],
            }),
        },
    ];
    ir.energy_terms = vec![
        fullmag_ir::EnergyTermIR::Exchange,
        fullmag_ir::EnergyTermIR::Demag { realization: None },
    ];
    ir.geometry_assets = Some(fullmag_ir::GeometryAssetsIR {
        fdm_grid_assets: vec![],
        fem_mesh_assets: vec![
            fullmag_ir::FemMeshAssetIR {
                geometry_name: "free_geom".to_string(),
                mesh_source: None,
                mesh: Some(fullmag_ir::MeshIR {
                    mesh_name: "free".to_string(),
                    nodes: vec![
                        [0.0, 0.0, 0.0],
                        [1.0, 0.0, 0.0],
                        [0.0, 1.0, 0.0],
                        [0.0, 0.0, 1.0],
                    ],
                    elements: vec![[0, 1, 2, 3]],
                    element_markers: vec![1],
                    boundary_faces: vec![[0, 1, 2]],
                    boundary_markers: vec![1],
                }),
            },
            fullmag_ir::FemMeshAssetIR {
                geometry_name: "ref_geom".to_string(),
                mesh_source: None,
                mesh: Some(fullmag_ir::MeshIR {
                    mesh_name: "ref".to_string(),
                    nodes: vec![
                        [0.0, 0.0, 2.0],
                        [1.0, 0.0, 2.0],
                        [0.0, 1.0, 2.0],
                        [0.0, 0.0, 3.0],
                    ],
                    elements: vec![[0, 1, 2, 3]],
                    element_markers: vec![1],
                    boundary_faces: vec![[0, 1, 2]],
                    boundary_markers: vec![1],
                }),
            },
        ],
        fem_domain_mesh_asset: None,
    });

    let plan = plan(&ir).expect("multi-body FEM should plan successfully");
    match plan.backend_plan {
        BackendPlanIR::Fem(fem) => {
            assert_eq!(fem.mesh.nodes.len(), 8);
            assert_eq!(fem.mesh.elements.len(), 2);
            assert_eq!(fem.initial_magnetization.len(), 8);
            assert_eq!(fem.object_segments.len(), 2);
            assert_eq!(fem.object_segments[0].object_id, "free");
            assert_eq!(
                fem.object_segments[0].geometry_id.as_deref(),
                Some("free_geom")
            );
            assert_eq!(fem.object_segments[0].node_start, 0);
            assert_eq!(fem.object_segments[0].node_count, 4);
            assert_eq!(fem.object_segments[0].element_start, 0);
            assert_eq!(fem.object_segments[0].element_count, 1);
            assert_eq!(fem.object_segments[0].boundary_face_start, 0);
            assert_eq!(fem.object_segments[0].boundary_face_count, 1);
            assert_eq!(fem.object_segments[1].object_id, "ref");
            assert_eq!(
                fem.object_segments[1].geometry_id.as_deref(),
                Some("ref_geom")
            );
            assert_eq!(fem.object_segments[1].node_start, 4);
            assert_eq!(fem.object_segments[1].node_count, 4);
            assert_eq!(fem.object_segments[1].element_start, 1);
            assert_eq!(fem.object_segments[1].element_count, 1);
            assert_eq!(fem.object_segments[1].boundary_face_start, 1);
            assert_eq!(fem.object_segments[1].boundary_face_count, 1);
            assert!(fem.enable_exchange);
            assert!(fem.enable_demag);
        }
        _ => panic!("expected FEM plan"),
    }
}

#[test]
fn fem_backend_multibody_rejects_incompatible_material_law() {
    let mut ir = ProblemIR::bootstrap_example();
    ir.backend_policy.requested_backend = BackendTarget::Fem;
    ir.materials.push(fullmag_ir::MaterialIR {
        name: "Co".to_string(),
        saturation_magnetisation: 1.1e6,
        exchange_stiffness: 20e-12,
        damping: 0.02,
        uniaxial_anisotropy: None,
        anisotropy_axis: None,
        uniaxial_anisotropy_k2: None,
        cubic_anisotropy_kc1: None,
        cubic_anisotropy_kc2: None,
        cubic_anisotropy_kc3: None,
        cubic_anisotropy_axis1: None,
        cubic_anisotropy_axis2: None,
        ms_field: None,
        a_field: None,
        alpha_field: None,
        ku_field: None,
        ku2_field: None,
        kc1_field: None,
        kc2_field: None,
        kc3_field: None,
    });
    ir.geometry.entries.push(GeometryEntryIR::Box {
        name: "second".to_string(),
        size: [1.0, 1.0, 1.0],
    });
    ir.regions.push(fullmag_ir::RegionIR {
        name: "second".to_string(),
        geometry: "second".to_string(),
    });
    ir.magnets.push(fullmag_ir::MagnetIR {
        name: "second".to_string(),
        region: "second".to_string(),
        material: "Co".to_string(),
        initial_magnetization: Some(InitialMagnetizationIR::Uniform {
            value: [0.0, 1.0, 0.0],
        }),
    });
    ir.geometry_assets = Some(fullmag_ir::GeometryAssetsIR {
        fdm_grid_assets: vec![],
        fem_mesh_assets: vec![
            fullmag_ir::FemMeshAssetIR {
                geometry_name: "strip".to_string(),
                mesh_source: None,
                mesh: Some(fullmag_ir::MeshIR {
                    mesh_name: "strip".to_string(),
                    nodes: vec![
                        [0.0, 0.0, 0.0],
                        [1.0, 0.0, 0.0],
                        [0.0, 1.0, 0.0],
                        [0.0, 0.0, 1.0],
                    ],
                    elements: vec![[0, 1, 2, 3]],
                    element_markers: vec![1],
                    boundary_faces: vec![[0, 1, 2]],
                    boundary_markers: vec![1],
                }),
            },
            fullmag_ir::FemMeshAssetIR {
                geometry_name: "second".to_string(),
                mesh_source: None,
                mesh: Some(fullmag_ir::MeshIR {
                    mesh_name: "second".to_string(),
                    nodes: vec![
                        [0.0, 0.0, 2.0],
                        [1.0, 0.0, 2.0],
                        [0.0, 1.0, 2.0],
                        [0.0, 0.0, 3.0],
                    ],
                    elements: vec![[0, 1, 2, 3]],
                    element_markers: vec![1],
                    boundary_faces: vec![[0, 1, 2]],
                    boundary_markers: vec![1],
                }),
            },
        ],
        fem_domain_mesh_asset: None,
    });

    let error = plan(&ir).expect_err("heterogeneous multi-body FEM materials should fail on CPU");
    assert!(error
        .reasons
        .iter()
        .any(|reason| reason.contains("native GPU FEM path")));
}

#[test]
fn fem_plan_heterogeneous_materials_populates_region_materials_for_cuda() {
    let mut ir = ProblemIR::bootstrap_example();
    ir.backend_policy.requested_backend = BackendTarget::Fem;
    ir.problem_meta.runtime_metadata.insert(
        "runtime_selection".to_string(),
        serde_json::json!({"device": "cuda", "device_index": 0}),
    );
    ir.materials.push(fullmag_ir::MaterialIR {
        name: "Co".to_string(),
        saturation_magnetisation: 1.1e6,
        exchange_stiffness: 20e-12,
        damping: 0.02,
        uniaxial_anisotropy: Some(5.0e4),
        anisotropy_axis: Some([0.0, 0.0, 1.0]),
        uniaxial_anisotropy_k2: None,
        cubic_anisotropy_kc1: None,
        cubic_anisotropy_kc2: None,
        cubic_anisotropy_kc3: None,
        cubic_anisotropy_axis1: None,
        cubic_anisotropy_axis2: None,
        ms_field: None,
        a_field: None,
        alpha_field: None,
        ku_field: None,
        ku2_field: None,
        kc1_field: None,
        kc2_field: None,
        kc3_field: None,
    });
    ir.materials[0].uniaxial_anisotropy = Some(2.5e4);
    ir.materials[0].damping = 0.5;
    ir.materials[0].anisotropy_axis = Some([0.0, 0.0, 1.0]);
    ir.geometry.entries.push(GeometryEntryIR::Box {
        name: "second".to_string(),
        size: [1.0, 1.0, 1.0],
    });
    ir.regions.push(fullmag_ir::RegionIR {
        name: "second".to_string(),
        geometry: "second".to_string(),
    });
    ir.magnets.push(fullmag_ir::MagnetIR {
        name: "second".to_string(),
        region: "second".to_string(),
        material: "Co".to_string(),
        initial_magnetization: Some(InitialMagnetizationIR::Uniform {
            value: [0.0, 1.0, 0.0],
        }),
    });
    ir.geometry_assets = Some(fullmag_ir::GeometryAssetsIR {
        fdm_grid_assets: vec![],
        fem_mesh_assets: vec![
            fullmag_ir::FemMeshAssetIR {
                geometry_name: "strip".to_string(),
                mesh_source: None,
                mesh: Some(fullmag_ir::MeshIR {
                    mesh_name: "strip".to_string(),
                    nodes: vec![
                        [0.0, 0.0, 0.0],
                        [1.0, 0.0, 0.0],
                        [0.0, 1.0, 0.0],
                        [0.0, 0.0, 1.0],
                    ],
                    elements: vec![[0, 1, 2, 3]],
                    element_markers: vec![1],
                    boundary_faces: vec![[0, 1, 2]],
                    boundary_markers: vec![1],
                }),
            },
            fullmag_ir::FemMeshAssetIR {
                geometry_name: "second".to_string(),
                mesh_source: None,
                mesh: Some(fullmag_ir::MeshIR {
                    mesh_name: "second".to_string(),
                    nodes: vec![
                        [0.0, 0.0, 2.0],
                        [1.0, 0.0, 2.0],
                        [0.0, 1.0, 2.0],
                        [0.0, 0.0, 3.0],
                    ],
                    elements: vec![[0, 1, 2, 3]],
                    element_markers: vec![1],
                    boundary_faces: vec![[0, 1, 2]],
                    boundary_markers: vec![1],
                }),
            },
        ],
        fem_domain_mesh_asset: None,
    });

    let planned = plan(&ir).expect("heterogeneous FEM should plan on CUDA");
    let BackendPlanIR::Fem(fem) = planned.backend_plan else {
        panic!("expected FEM plan");
    };

    assert_eq!(fem.region_materials.len(), 2);
    assert_eq!(fem.region_materials[0].object_id, "strip");
    assert_eq!(fem.region_materials[1].object_id, "second");
    assert_eq!(fem.mesh_parts.len(), 2);
    assert_eq!(fem.mesh_parts[0].material_id.as_deref(), Some("Py"));
    assert_eq!(fem.mesh_parts[1].material_id.as_deref(), Some("Co"));
    assert!(fem.material.ms_field.is_some());
}

#[test]
fn fem_plan_conformal_shared_domain_duplicates_interface_nodes_for_cuda() {
    let mut ir = ProblemIR::bootstrap_example();
    ir.backend_policy.requested_backend = BackendTarget::Fem;
    ir.problem_meta.runtime_metadata.insert(
        "runtime_selection".to_string(),
        serde_json::json!({"device": "cuda", "device_index": 0}),
    );
    ir.geometry.entries.push(GeometryEntryIR::Box {
        name: "second".to_string(),
        size: [1.0, 1.0, 1.0],
    });
    ir.regions.push(fullmag_ir::RegionIR {
        name: "second".to_string(),
        geometry: "second".to_string(),
    });
    ir.magnets.push(fullmag_ir::MagnetIR {
        name: "second".to_string(),
        region: "second".to_string(),
        material: "Py".to_string(),
        initial_magnetization: Some(InitialMagnetizationIR::Uniform {
            value: [0.0, 1.0, 0.0],
        }),
    });
    ir.geometry_assets = Some(fullmag_ir::GeometryAssetsIR {
        fdm_grid_assets: vec![],
        fem_mesh_assets: vec![],
        fem_domain_mesh_asset: Some(fullmag_ir::FemDomainMeshAssetIR {
            mesh_source: None,
            mesh: Some(fullmag_ir::MeshIR {
                mesh_name: "touching".to_string(),
                nodes: vec![
                    [0.0, 0.0, 0.0],
                    [1.0, 0.0, 0.0],
                    [0.0, 1.0, 0.0],
                    [0.0, 0.0, 1.0],
                    [0.0, 0.0, -1.0],
                ],
                elements: vec![[0, 1, 2, 3], [0, 1, 2, 4]],
                element_markers: vec![1, 2],
                boundary_faces: vec![[0, 1, 3], [0, 1, 4]],
                boundary_markers: vec![10, 20],
            }),
            region_markers: vec![
                fullmag_ir::FemDomainRegionMarkerIR {
                    geometry_name: "strip".to_string(),
                    marker: 1,
                },
                fullmag_ir::FemDomainRegionMarkerIR {
                    geometry_name: "second".to_string(),
                    marker: 2,
                },
            ],
        }),
    });
    ir.energy_terms = vec![fullmag_ir::EnergyTermIR::Exchange];

    let planned = plan(&ir).expect("CUDA FEM should accept conformal shared-domain meshes");
    let BackendPlanIR::Fem(fem) = planned.backend_plan else {
        panic!("expected FEM plan");
    };

    assert_eq!(fem.mesh.nodes.len(), 8);
    assert_eq!(fem.object_segments.len(), 2);
    assert_eq!(fem.object_segments[0].object_id, "strip");
    assert_eq!(fem.object_segments[0].node_count, 4);
    assert_eq!(fem.object_segments[1].object_id, "second");
    assert_eq!(fem.object_segments[1].node_count, 4);
}

#[test]
fn random_seeded_generates_correct_count() {
    let vectors = generate_random_unit_vectors(42, 100);
    assert_eq!(vectors.len(), 100);
    for v in &vectors {
        let norm = (v[0] * v[0] + v[1] * v[1] + v[2] * v[2]).sqrt();
        assert!((norm - 1.0).abs() < 1e-10, "vector not unit: norm={}", norm);
    }
}

#[test]
fn inactive_term_output_is_rejected_for_execution() {
    let mut ir = ProblemIR::bootstrap_example();
    let mut outputs = ir.study.sampling().outputs.clone();
    outputs.push(OutputIR::Field {
        name: "H_demag".to_string(),
        every_seconds: 1e-12,
    });
    ir.study = fullmag_ir::StudyIR::TimeEvolution {
        dynamics: ir.study.dynamics().clone(),
        sampling: fullmag_ir::SamplingIR { outputs },
    };

    let err = plan(&ir).expect_err("output requiring inactive term should be rejected");
    assert!(err
        .reasons
        .iter()
        .any(|reason| reason.contains("requires Demag()")));
}

#[test]
fn llg_overdamped_relaxation_lowers_to_relaxation_control() {
    let mut ir = ProblemIR::bootstrap_example();
    ir.study = fullmag_ir::StudyIR::Relaxation {
        algorithm: fullmag_ir::RelaxationAlgorithmIR::LlgOverdamped,
        dynamics: ir.study.dynamics().clone(),
        torque_tolerance: 1e-3,
        energy_tolerance: Some(1e-12),
        max_steps: 250,
        sampling: ir.study.sampling().clone(),
    };

    let plan = plan(&ir).expect("llg_overdamped relaxation should be plannable");
    match plan.backend_plan {
        BackendPlanIR::Fdm(fdm) => {
            let control = fdm.relaxation.expect("relaxation control");
            assert_eq!(
                control.algorithm,
                fullmag_ir::RelaxationAlgorithmIR::LlgOverdamped
            );
            assert_eq!(control.max_steps, 250);
            assert_eq!(control.energy_tolerance, Some(1e-12));
        }
        _ => panic!("expected FDM plan"),
    }
}

#[test]
fn projected_gradient_bb_is_now_plannable() {
    let mut ir = ProblemIR::bootstrap_example();
    ir.study = fullmag_ir::StudyIR::Relaxation {
        algorithm: fullmag_ir::RelaxationAlgorithmIR::ProjectedGradientBb,
        dynamics: ir.study.dynamics().clone(),
        torque_tolerance: 1e-3,
        energy_tolerance: None,
        max_steps: 250,
        sampling: ir.study.sampling().clone(),
    };

    let plan = plan(&ir).expect("projected_gradient_bb should now plan successfully");
    match plan.backend_plan {
        BackendPlanIR::Fdm(fdm) => {
            let control = fdm.relaxation.expect("relaxation control");
            assert_eq!(
                control.algorithm,
                fullmag_ir::RelaxationAlgorithmIR::ProjectedGradientBb
            );
        }
        _ => panic!("expected FDM plan"),
    }
}

#[test]
fn nonlinear_cg_is_now_plannable() {
    let mut ir = ProblemIR::bootstrap_example();
    ir.study = fullmag_ir::StudyIR::Relaxation {
        algorithm: fullmag_ir::RelaxationAlgorithmIR::NonlinearCg,
        dynamics: ir.study.dynamics().clone(),
        torque_tolerance: 1e-3,
        energy_tolerance: None,
        max_steps: 250,
        sampling: ir.study.sampling().clone(),
    };

    let plan = plan(&ir).expect("nonlinear_cg should now plan successfully");
    match plan.backend_plan {
        BackendPlanIR::Fdm(fdm) => {
            let control = fdm.relaxation.expect("relaxation control");
            assert_eq!(
                control.algorithm,
                fullmag_ir::RelaxationAlgorithmIR::NonlinearCg
            );
        }
        _ => panic!("expected FDM plan"),
    }
}

#[test]
fn tangent_plane_implicit_is_still_gated() {
    let mut ir = ProblemIR::bootstrap_example();
    ir.study = fullmag_ir::StudyIR::Relaxation {
        algorithm: fullmag_ir::RelaxationAlgorithmIR::TangentPlaneImplicit,
        dynamics: ir.study.dynamics().clone(),
        torque_tolerance: 1e-3,
        energy_tolerance: None,
        max_steps: 250,
        sampling: ir.study.sampling().clone(),
    };

    let err = plan(&ir).expect_err("tangent_plane_implicit should not be executable yet");
    assert!(err.reasons.iter().any(|reason| {
        reason.contains("tangent_plane_implicit") && reason.contains("not yet executable")
    }));
}

#[test]
fn single_precision_is_rejected_for_phase_one_cpu_execution() {
    let mut ir = ProblemIR::bootstrap_example();
    ir.backend_policy.execution_precision = ExecutionPrecision::Single;

    let err = plan(&ir).expect_err("single precision should not be executable on CPU reference");
    assert!(err
        .reasons
        .iter()
        .any(|reason| reason.contains("execution_precision='single'")));
}

#[test]
fn single_precision_is_accepted_when_cuda_device_requested() {
    let mut ir = ProblemIR::bootstrap_example();
    ir.backend_policy.execution_precision = ExecutionPrecision::Single;
    ir.problem_meta.runtime_metadata.insert(
        "runtime_selection".to_string(),
        serde_json::json!({"device": "cuda", "device_index": 0}),
    );

    let result = plan(&ir);
    // Planning should succeed (no precision error); execution may still
    // fail later if the machine has no GPU, but that is the runner's job.
    assert!(
        result.is_ok()
            || !result
                .as_ref()
                .unwrap_err()
                .reasons
                .iter()
                .any(|r| r.contains("execution_precision='single'")),
        "planner should not reject single precision when CUDA device is requested"
    );
}

#[test]
fn multilayer_single_precision_is_rejected_without_cuda_device_request() {
    let mut ir = ProblemIR::bootstrap_example();
    ir.geometry.entries = vec![
        GeometryEntryIR::Translate {
            name: "free_geom".to_string(),
            base: std::boxed::Box::new(GeometryEntryIR::Box {
                name: "free_base".to_string(),
                size: [40e-9, 20e-9, 2e-9],
            }),
            by: [0.0, 0.0, 0.0],
        },
        GeometryEntryIR::Translate {
            name: "ref_geom".to_string(),
            base: std::boxed::Box::new(GeometryEntryIR::Box {
                name: "ref_base".to_string(),
                size: [40e-9, 20e-9, 2e-9],
            }),
            by: [0.0, 0.0, 4e-9],
        },
    ];
    ir.regions = vec![
        fullmag_ir::RegionIR {
            name: "free_region".to_string(),
            geometry: "free_geom".to_string(),
        },
        fullmag_ir::RegionIR {
            name: "ref_region".to_string(),
            geometry: "ref_geom".to_string(),
        },
    ];
    ir.magnets = vec![
        fullmag_ir::MagnetIR {
            name: "free".to_string(),
            region: "free_region".to_string(),
            material: "Py".to_string(),
            initial_magnetization: Some(InitialMagnetizationIR::Uniform {
                value: [1.0, 0.0, 0.0],
            }),
        },
        fullmag_ir::MagnetIR {
            name: "ref".to_string(),
            region: "ref_region".to_string(),
            material: "Py".to_string(),
            initial_magnetization: Some(InitialMagnetizationIR::Uniform {
                value: [0.0, 1.0, 0.0],
            }),
        },
    ];
    ir.energy_terms = vec![
        fullmag_ir::EnergyTermIR::Exchange,
        fullmag_ir::EnergyTermIR::Demag { realization: None },
    ];
    ir.backend_policy.execution_precision = ExecutionPrecision::Single;
    ir.backend_policy.discretization_hints = Some(fullmag_ir::DiscretizationHintsIR {
        fdm: Some(fullmag_ir::FdmHintsIR {
            cell: [2e-9, 2e-9, 2e-9],
            default_cell: Some([2e-9, 2e-9, 2e-9]),
            per_magnet: None,
            demag: Some(fullmag_ir::FdmDemagHintsIR {
                strategy: "multilayer_convolution".to_string(),
                mode: "two_d_stack".to_string(),
                allow_single_grid_fallback: false,
                common_cells: None,
                common_cells_xy: None,
            }),
            boundary_correction: None,
        }),
        fem: None,
        hybrid: None,
    });

    let err = plan(&ir).expect_err("multilayer single precision should be rejected on CPU");
    assert!(err.reasons.iter().any(|reason| {
        reason.contains("execution_precision='single'")
            && reason.contains("CPU reference multilayer FDM runner")
    }));
}

#[test]
fn multilayer_single_precision_is_accepted_when_cuda_device_requested() {
    let mut ir = ProblemIR::bootstrap_example();
    ir.geometry.entries = vec![
        GeometryEntryIR::Translate {
            name: "free_geom".to_string(),
            base: std::boxed::Box::new(GeometryEntryIR::Box {
                name: "free_base".to_string(),
                size: [40e-9, 20e-9, 2e-9],
            }),
            by: [0.0, 0.0, 0.0],
        },
        GeometryEntryIR::Translate {
            name: "ref_geom".to_string(),
            base: std::boxed::Box::new(GeometryEntryIR::Box {
                name: "ref_base".to_string(),
                size: [40e-9, 20e-9, 2e-9],
            }),
            by: [0.0, 0.0, 4e-9],
        },
    ];
    ir.regions = vec![
        fullmag_ir::RegionIR {
            name: "free_region".to_string(),
            geometry: "free_geom".to_string(),
        },
        fullmag_ir::RegionIR {
            name: "ref_region".to_string(),
            geometry: "ref_geom".to_string(),
        },
    ];
    ir.magnets = vec![
        fullmag_ir::MagnetIR {
            name: "free".to_string(),
            region: "free_region".to_string(),
            material: "Py".to_string(),
            initial_magnetization: Some(InitialMagnetizationIR::Uniform {
                value: [1.0, 0.0, 0.0],
            }),
        },
        fullmag_ir::MagnetIR {
            name: "ref".to_string(),
            region: "ref_region".to_string(),
            material: "Py".to_string(),
            initial_magnetization: Some(InitialMagnetizationIR::Uniform {
                value: [0.0, 1.0, 0.0],
            }),
        },
    ];
    ir.energy_terms = vec![
        fullmag_ir::EnergyTermIR::Exchange,
        fullmag_ir::EnergyTermIR::Demag { realization: None },
    ];
    ir.backend_policy.execution_precision = ExecutionPrecision::Single;
    ir.problem_meta.runtime_metadata.insert(
        "runtime_selection".to_string(),
        serde_json::json!({"device": "cuda", "device_index": 0}),
    );
    ir.backend_policy.discretization_hints = Some(fullmag_ir::DiscretizationHintsIR {
        fdm: Some(fullmag_ir::FdmHintsIR {
            cell: [2e-9, 2e-9, 2e-9],
            default_cell: Some([2e-9, 2e-9, 2e-9]),
            per_magnet: None,
            demag: Some(fullmag_ir::FdmDemagHintsIR {
                strategy: "multilayer_convolution".to_string(),
                mode: "two_d_stack".to_string(),
                allow_single_grid_fallback: false,
                common_cells: None,
                common_cells_xy: None,
            }),
            boundary_correction: None,
        }),
        fem: None,
        hybrid: None,
    });

    let result = plan(&ir);
    assert!(
        result.is_ok()
            || !result
                .as_ref()
                .unwrap_err()
                .reasons
                .iter()
                .any(|reason| reason.contains("execution_precision='single'")),
        "planner should not reject multilayer single precision when CUDA device is requested"
    );
}

#[test]
fn stacked_two_body_problem_lowers_to_multilayer_plan() {
    let mut ir = ProblemIR::bootstrap_example();
    ir.geometry.entries = vec![
        GeometryEntryIR::Translate {
            name: "free_geom".to_string(),
            base: std::boxed::Box::new(GeometryEntryIR::Box {
                name: "free_base".to_string(),
                size: [40e-9, 20e-9, 2e-9],
            }),
            by: [0.0, 0.0, 0.0],
        },
        GeometryEntryIR::Translate {
            name: "ref_geom".to_string(),
            base: std::boxed::Box::new(GeometryEntryIR::Box {
                name: "ref_base".to_string(),
                size: [40e-9, 20e-9, 2e-9],
            }),
            by: [0.0, 0.0, 4e-9],
        },
    ];
    ir.regions = vec![
        fullmag_ir::RegionIR {
            name: "free_region".to_string(),
            geometry: "free_geom".to_string(),
        },
        fullmag_ir::RegionIR {
            name: "ref_region".to_string(),
            geometry: "ref_geom".to_string(),
        },
    ];
    ir.magnets = vec![
        fullmag_ir::MagnetIR {
            name: "free".to_string(),
            region: "free_region".to_string(),
            material: "Py".to_string(),
            initial_magnetization: Some(InitialMagnetizationIR::Uniform {
                value: [1.0, 0.0, 0.0],
            }),
        },
        fullmag_ir::MagnetIR {
            name: "ref".to_string(),
            region: "ref_region".to_string(),
            material: "Py".to_string(),
            initial_magnetization: Some(InitialMagnetizationIR::Uniform {
                value: [0.0, 1.0, 0.0],
            }),
        },
    ];
    ir.energy_terms = vec![
        fullmag_ir::EnergyTermIR::Exchange,
        fullmag_ir::EnergyTermIR::Demag { realization: None },
    ];
    ir.backend_policy.discretization_hints = Some(fullmag_ir::DiscretizationHintsIR {
        fdm: Some(fullmag_ir::FdmHintsIR {
            cell: [2e-9, 2e-9, 2e-9],
            default_cell: Some([2e-9, 2e-9, 2e-9]),
            per_magnet: None,
            demag: Some(fullmag_ir::FdmDemagHintsIR {
                strategy: "multilayer_convolution".to_string(),
                mode: "two_d_stack".to_string(),
                allow_single_grid_fallback: false,
                common_cells: None,
                common_cells_xy: None,
            }),
            boundary_correction: None,
        }),
        fem: None,
        hybrid: None,
    });

    let plan = plan(&ir).expect("stacked two-body problem should lower");
    match plan.backend_plan {
        BackendPlanIR::FdmMultilayer(multilayer) => {
            assert_eq!(multilayer.layers.len(), 2);
            assert_eq!(multilayer.common_cells, [20, 10, 1]);
            for (actual, expected) in multilayer.layers[0]
                .native_origin
                .iter()
                .zip([-20e-9, -10e-9, -1e-9].iter())
            {
                assert!((actual - expected).abs() < 1e-18);
            }
            for (actual, expected) in multilayer.layers[1]
                .native_origin
                .iter()
                .zip([-20e-9, -10e-9, 3e-9].iter())
            {
                assert!((actual - expected).abs() < 1e-18);
            }
            assert_eq!(
                multilayer.planner_summary.selected_strategy,
                "multilayer_convolution"
            );
        }
        other => panic!("expected FDM multilayer plan, got {other:?}"),
    }
}

#[test]
fn multilayer_planner_rejects_xy_offset() {
    let mut ir = ProblemIR::bootstrap_example();
    ir.geometry.entries = vec![
        GeometryEntryIR::Translate {
            name: "free_geom".to_string(),
            base: std::boxed::Box::new(GeometryEntryIR::Box {
                name: "free_base".to_string(),
                size: [40e-9, 20e-9, 2e-9],
            }),
            by: [0.0, 0.0, 0.0],
        },
        GeometryEntryIR::Translate {
            name: "ref_geom".to_string(),
            base: std::boxed::Box::new(GeometryEntryIR::Box {
                name: "ref_base".to_string(),
                size: [40e-9, 20e-9, 2e-9],
            }),
            by: [10e-9, 0.0, 4e-9],
        },
    ];
    ir.regions = vec![
        fullmag_ir::RegionIR {
            name: "free_region".to_string(),
            geometry: "free_geom".to_string(),
        },
        fullmag_ir::RegionIR {
            name: "ref_region".to_string(),
            geometry: "ref_geom".to_string(),
        },
    ];
    ir.magnets = vec![
        fullmag_ir::MagnetIR {
            name: "free".to_string(),
            region: "free_region".to_string(),
            material: "Py".to_string(),
            initial_magnetization: None,
        },
        fullmag_ir::MagnetIR {
            name: "ref".to_string(),
            region: "ref_region".to_string(),
            material: "Py".to_string(),
            initial_magnetization: None,
        },
    ];
    ir.energy_terms = vec![fullmag_ir::EnergyTermIR::Demag { realization: None }];

    let err = plan(&ir).expect_err("XY-offset multilayer problem should be rejected");
    assert!(err
        .reasons
        .iter()
        .any(|reason| reason.contains("share the same XY center")));
}

#[test]
fn fem_eigen_backend_with_mesh_asset_plans_successfully() {
    let mut ir = ProblemIR::bootstrap_example();
    ir.backend_policy.requested_backend = BackendTarget::Fem;
    ir.backend_policy.discretization_hints = Some(fullmag_ir::DiscretizationHintsIR {
        fdm: Some(fullmag_ir::FdmHintsIR {
            cell: [2e-9, 2e-9, 5e-9],
            default_cell: None,
            per_magnet: None,
            demag: None,
            boundary_correction: None,
        }),
        fem: Some(fullmag_ir::FemHintsIR {
            order: 1,
            hmax: 2e-9,
            mesh: Some("meshes/unit_tet.msh".to_string()),
        }),
        hybrid: None,
    });
    ir.geometry_assets = Some(fullmag_ir::GeometryAssetsIR {
        fdm_grid_assets: vec![],
        fem_mesh_assets: vec![fullmag_ir::FemMeshAssetIR {
            geometry_name: "strip".to_string(),
            mesh_source: Some("meshes/unit_tet.msh".to_string()),
            mesh: Some(fullmag_ir::MeshIR {
                mesh_name: "strip".to_string(),
                nodes: vec![
                    [0.0, 0.0, 0.0],
                    [1.0, 0.0, 0.0],
                    [0.0, 1.0, 0.0],
                    [0.0, 0.0, 1.0],
                ],
                elements: vec![[0, 1, 2, 3]],
                element_markers: vec![1],
                boundary_faces: vec![[0, 1, 2]],
                boundary_markers: vec![1],
            }),
        }],
        fem_domain_mesh_asset: None,
    });
    ir.energy_terms = vec![
        fullmag_ir::EnergyTermIR::Exchange,
        fullmag_ir::EnergyTermIR::Demag { realization: None },
    ];
    ir.study = fullmag_ir::StudyIR::Eigenmodes {
        dynamics: ir.study.dynamics().clone(),
        operator: fullmag_ir::EigenOperatorConfigIR {
            kind: fullmag_ir::EigenOperatorIR::LinearizedLlg,
            include_demag: false,
        },
        count: 5,
        target: fullmag_ir::EigenTargetIR::Lowest,
        equilibrium: fullmag_ir::EquilibriumSourceIR::Provided,
        k_sampling: Some(fullmag_ir::KSamplingIR::Single {
            k_vector: [0.0, 0.0, 0.0],
        }),
        normalization: fullmag_ir::EigenNormalizationIR::UnitL2,
        damping_policy: fullmag_ir::EigenDampingPolicyIR::Ignore,
        sampling: fullmag_ir::SamplingIR {
            outputs: vec![
                fullmag_ir::OutputIR::EigenSpectrum {
                    quantity: "eigenfrequency".to_string(),
                },
                fullmag_ir::OutputIR::EigenMode {
                    field: "mode".to_string(),
                    indices: vec![0, 1],
                },
            ],
        },
    };

    let plan = plan(&ir).expect("FEM eigen mesh asset should produce a FemEigenPlanIR");
    match plan.backend_plan {
        BackendPlanIR::FemEigen(fem) => {
            assert_eq!(fem.mesh.mesh_name, "strip");
            assert_eq!(fem.mesh.nodes.len(), 4);
            assert_eq!(fem.count, 5);
            assert_eq!(fem.target, fullmag_ir::EigenTargetIR::Lowest);
            assert!(fem.enable_exchange);
            assert!(!fem.enable_demag);
            assert_eq!(fem.normalization, fullmag_ir::EigenNormalizationIR::UnitL2);
        }
        other => panic!("expected FEM eigen plan, got {other:?}"),
    }
}

#[test]
fn fem_eigen_accepts_shared_domain_mesh_with_air_when_transfer_grid_is_used() {
    let mut ir = ProblemIR::bootstrap_example();
    ir.backend_policy.requested_backend = BackendTarget::Fem;
    ir.backend_policy.discretization_hints = Some(fullmag_ir::DiscretizationHintsIR {
        fdm: Some(fullmag_ir::FdmHintsIR {
            cell: [2e-9, 2e-9, 5e-9],
            default_cell: None,
            per_magnet: None,
            demag: None,
            boundary_correction: None,
        }),
        fem: Some(fullmag_ir::FemHintsIR {
            order: 1,
            hmax: 2e-9,
            mesh: Some("meshes/unit_tet.msh".to_string()),
        }),
        hybrid: None,
    });
    ir.geometry_assets = Some(fullmag_ir::GeometryAssetsIR {
        fdm_grid_assets: vec![],
        fem_mesh_assets: vec![],
        fem_domain_mesh_asset: Some(fullmag_ir::FemDomainMeshAssetIR {
            mesh_source: Some("meshes/unit_tet.msh".to_string()),
            mesh: Some(fullmag_ir::MeshIR {
                mesh_name: "strip_air".to_string(),
                nodes: vec![
                    [0.0, 0.0, 0.0],
                    [1.0, 0.0, 0.0],
                    [0.0, 1.0, 0.0],
                    [0.0, 0.0, 1.0],
                    [-2.0, -2.0, -2.0],
                    [2.0, -2.0, -2.0],
                    [-2.0, 2.0, -2.0],
                    [-2.0, -2.0, 2.0],
                ],
                elements: vec![[0, 1, 2, 3], [4, 5, 6, 7]],
                element_markers: vec![1, 0],
                boundary_faces: vec![[0, 1, 2], [4, 5, 6]],
                boundary_markers: vec![10, 99],
            }),
            region_markers: vec![fullmag_ir::FemDomainRegionMarkerIR {
                geometry_name: "strip".to_string(),
                marker: 1,
            }],
        }),
    });
    ir.energy_terms = vec![
        fullmag_ir::EnergyTermIR::Exchange,
        fullmag_ir::EnergyTermIR::Demag { realization: None },
    ];
    ir.study = fullmag_ir::StudyIR::Eigenmodes {
        dynamics: ir.study.dynamics().clone(),
        operator: fullmag_ir::EigenOperatorConfigIR {
            kind: fullmag_ir::EigenOperatorIR::LinearizedLlg,
            include_demag: true,
        },
        count: 3,
        target: fullmag_ir::EigenTargetIR::Lowest,
        equilibrium: fullmag_ir::EquilibriumSourceIR::Provided,
        k_sampling: None,
        normalization: fullmag_ir::EigenNormalizationIR::UnitL2,
        damping_policy: fullmag_ir::EigenDampingPolicyIR::Ignore,
        sampling: fullmag_ir::SamplingIR {
            outputs: vec![fullmag_ir::OutputIR::EigenSpectrum {
                quantity: "eigenfrequency".to_string(),
            }],
        },
    };

    let plan = plan(&ir).expect("shared-domain FEM eigen mesh should now plan");
    match plan.backend_plan {
        BackendPlanIR::FemEigen(fem) => {
            assert_eq!(
                fem.domain_mesh_mode,
                fullmag_ir::FemDomainMeshModeIR::SharedDomainMeshWithAir
            );
            assert_eq!(fem.demag_realization.as_deref(), Some("transfer_grid"));
            assert_eq!(fem.object_segments.len(), 2);
            assert_eq!(fem.object_segments[0].object_id, "strip");
            assert_eq!(fem.object_segments[0].geometry_id.as_deref(), Some("strip"));
            assert_eq!(fem.object_segments[0].node_count, 4);
            assert_eq!(fem.object_segments[1].object_id, "__air__");
            assert_eq!(fem.object_segments[1].geometry_id, None);
            assert_eq!(fem.object_segments[1].node_count, 4);
            assert_eq!(fem.equilibrium_magnetization.len(), 8);
            let magnetic_start = fem.object_segments[0].node_start as usize;
            let magnetic_end = magnetic_start + fem.object_segments[0].node_count as usize;
            assert!(fem.equilibrium_magnetization[magnetic_start..magnetic_end]
                .iter()
                .all(|value| value.iter().any(|component| component.abs() > 0.0)));
            assert!(fem
                .equilibrium_magnetization
                .iter()
                .enumerate()
                .filter(|(index, _)| *index < magnetic_start || *index >= magnetic_end)
                .all(|(_, value)| *value == [0.0, 0.0, 0.0]));
        }
        other => panic!("expected FEM eigen plan, got {other:?}"),
    }
}
