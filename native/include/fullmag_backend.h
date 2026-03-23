#ifndef FULLMAG_BACKEND_H
#define FULLMAG_BACKEND_H

#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

typedef struct fullmag_backend fullmag_backend;

typedef struct fullmag_plan {
    const char *problem_name;
    const char *backend_name;
} fullmag_plan;

typedef struct fullmag_run_options {
    uint64_t max_steps;
    double stop_time_seconds;
} fullmag_run_options;

typedef struct fullmag_array_view {
    void *data;
    uint64_t len;
    uint64_t stride;
} fullmag_array_view;

fullmag_backend *fullmag_backend_create(const fullmag_plan *plan);
int fullmag_backend_run(fullmag_backend *handle, const fullmag_run_options *opts);
int fullmag_backend_step(fullmag_backend *handle, uint64_t steps);
int fullmag_backend_get_field(fullmag_backend *handle, const char *name, fullmag_array_view *out);
void fullmag_backend_destroy(fullmag_backend *handle);

#ifdef __cplusplus
}
#endif

#endif
