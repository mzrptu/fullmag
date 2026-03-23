cmake_minimum_required(VERSION 3.24)
project(fullmag_native LANGUAGES C CXX)

add_subdirectory(backends/fdm)
add_subdirectory(backends/fem)
