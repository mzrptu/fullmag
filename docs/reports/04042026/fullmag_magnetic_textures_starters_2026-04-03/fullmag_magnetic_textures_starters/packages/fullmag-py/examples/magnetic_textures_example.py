"""Starter example for the proposed magnetic texture preset DSL."""

import fullmag as fm

study = fm.study("texture_demo")
study.engine("fem")
study.device("cuda:0", precision="double")

disk = study.geometry(fm.Cylinder(160e-9, 2e-9), name="disk")
disk.Ms = 580e3
disk.Aex = 15e-12
disk.alpha = 0.02

disk.m = (
    fm.texture.neel_skyrmion(
        radius=35e-9,
        wall_width=10e-9,
        chirality=1,
        core_polarity=-1,
    )
    .translate(20e-9, 0, 0)
    .rotate_z_deg(25)
)

study.build_domain_mesh()
