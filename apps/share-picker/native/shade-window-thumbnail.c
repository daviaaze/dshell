/*
 * Exact-window snapshots for the share picker, never monitor crops. Arguments
 * are alternating lower-case hexadecimal Hyprland stableId/output-path pairs.
 * Output paths belong to this invocation: old files are removed first, then
 * only complete PNGs are atomically published. A failed request stays absent.
 *
 * One Wayland connection serves at most 128 requests. Captures are sequential,
 * with at most one 128 MiB SHM mapping and one 320-pixel conversion row. Protocol
 * waits share a 3.5-second deadline; the four-second alarm also bounds file I/O.
 */

#define _GNU_SOURCE

#include <errno.h>
#include <fcntl.h>
#include <limits.h>
#include <poll.h>
#include <signal.h>
#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/mman.h>
#include <time.h>
#include <unistd.h>

#include <png.h>
#include <wayland-client.h>

#include "ext-foreign-toplevel-list-v1-client-protocol.h"
#include "ext-image-capture-source-v1-client-protocol.h"
#include "ext-image-copy-capture-v1-client-protocol.h"

#define UNUSED __attribute__((unused))

enum {
    MAX_REQUESTS = 128,
    DISCOVERY_TIMEOUT_MS = 600,
    FRAME_TIMEOUT_MS = 350,
    BATCH_TIMEOUT_MS = 3500,
    MAX_CAPTURE_EDGE = 8192,
    MAX_CAPTURE_BYTES = 128 * 1024 * 1024,
    THUMBNAIL_EDGE = 320,
};

struct pixel_format {
    uint32_t shm;
    bool red_low;
    bool alpha;
    bool ten_bit;
};

// Hyprland can advertise only a 10-bit SHM format on a 10-bit output.
static const struct pixel_format formats[] = {
    {WL_SHM_FORMAT_ARGB8888, false, true, false},
    {WL_SHM_FORMAT_ABGR8888, true, true, false},
    {WL_SHM_FORMAT_XRGB8888, false, false, false},
    {WL_SHM_FORMAT_XBGR8888, true, false, false},
    {WL_SHM_FORMAT_ARGB2101010, false, true, true},
    {WL_SHM_FORMAT_ABGR2101010, true, true, true},
    {WL_SHM_FORMAT_XRGB2101010, false, false, true},
    {WL_SHM_FORMAT_XBGR2101010, true, false, true},
};

static unsigned format_mask(uint32_t format) {
    for (size_t i = 0; i < sizeof(formats) / sizeof(formats[0]); ++i)
        if (formats[i].shm == format)
            return 1u << i;
    return 0;
}

struct request {
    const char *identifier;
    const char *path;
    size_t owner;
    struct ext_foreign_toplevel_handle_v1 *handle;
    bool listed;
};

struct worker {
    struct wl_display *display;
    struct wl_registry *registry;
    struct wl_shm *shm;
    struct ext_foreign_toplevel_list_v1 *list;
    struct ext_foreign_toplevel_image_capture_source_manager_v1 *sources;
    struct ext_image_copy_capture_manager_v1 *capture;
    struct request requests[MAX_REQUESTS];
    size_t count;
    unsigned shm_formats;
    bool discovering;
    bool list_finished;
    bool disconnected;
};

struct constraints {
    uint32_t width;
    uint32_t height;
    unsigned formats;
};

struct capture_state {
    struct constraints pending;
    struct constraints constraints;
    uint32_t transform;
    bool have_constraints;
    bool ready;
    bool failed;
};

struct image {
    const struct pixel_format *format;
    void *pixels;
    size_t bytes;
    int32_t width;
    int32_t height;
    int32_t stride;
    uint32_t transform;
};

static int64_t monotonic_ms(void) {
    struct timespec now;
    if (clock_gettime(CLOCK_MONOTONIC, &now) < 0)
        return -1;
    return (int64_t)now.tv_sec * 1000 + now.tv_nsec / 1000000;
}

static bool wait_for(struct worker *worker, const bool *done, const bool *failed,
                     int64_t deadline) {
    struct wl_display *display = worker->display;
    struct pollfd fd = {.fd = wl_display_get_fd(display)};
    for (;;) {
        if (wl_display_dispatch_pending(display) < 0)
            break;
        if (failed && *failed)
            return false;
        const int64_t now = monotonic_ms();
        if (now < 0 || now >= deadline)
            return false;
        if (*done)
            return true;
        if (wl_display_prepare_read(display) < 0)
            continue;

        const int flushed = wl_display_flush(display);
        if (flushed < 0 && errno != EAGAIN) {
            wl_display_cancel_read(display);
            break;
        }
        fd.events = POLLIN | (flushed < 0 ? POLLOUT : 0);
        const int result = poll(&fd, 1, (int)(deadline - now));
        const int poll_error = errno;
        if (result > 0 && (fd.revents & POLLIN)) {
            if (wl_display_read_events(display) < 0)
                break;
        } else {
            wl_display_cancel_read(display);
            if (result == 0)
                return false;
            if (result < 0 ? poll_error != EINTR : fd.revents & (POLLERR | POLLHUP | POLLNVAL))
                break;
        }
    }
    worker->disconnected = true;
    return false;
}

static void sync_done(void *data, struct wl_callback *callback UNUSED, uint32_t serial UNUSED) {
    *(bool *)data = true;
}

static bool sync_to(struct worker *worker, int64_t deadline) {
    static const struct wl_callback_listener listener = {.done = sync_done};
    bool done = false;
    struct wl_callback *callback = wl_display_sync(worker->display);
    if (!callback)
        return false;
    wl_callback_add_listener(callback, &listener, &done);
    const bool synced = wait_for(worker, &done, NULL, deadline);
    wl_callback_destroy(callback);
    return synced;
}

static void toplevel_closed(void *data, struct ext_foreign_toplevel_handle_v1 *handle) {
    struct worker *worker = data;
    for (size_t i = 0; i < worker->count; ++i) {
        if (worker->requests[i].handle == handle) {
            worker->requests[i].handle = NULL;
            worker->requests[i].listed = false;
            break;
        }
    }
    ext_foreign_toplevel_handle_v1_destroy(handle);
}

static void toplevel_done(void *data, struct ext_foreign_toplevel_handle_v1 *handle) {
    struct worker *worker = data;
    for (size_t i = 0; i < worker->count; ++i) {
        if (worker->requests[i].handle == handle) {
            worker->requests[i].listed = true;
            break;
        }
    }
}

static void toplevel_identifier(void *data, struct ext_foreign_toplevel_handle_v1 *handle,
                                const char *identifier) {
    struct worker *worker = data;
    for (size_t i = 0; i < worker->count; ++i) {
        struct request *request = &worker->requests[i];
        if (request->owner == i && !request->handle && strcmp(request->identifier, identifier) == 0) {
            request->handle = handle;
            return;
        }
    }
    ext_foreign_toplevel_handle_v1_destroy(handle);
}

static void ignore_toplevel_text(void *data UNUSED, struct ext_foreign_toplevel_handle_v1 *handle UNUSED,
                                 const char *value UNUSED) {}

static const struct ext_foreign_toplevel_handle_v1_listener toplevel_listener = {
    .closed = toplevel_closed,
    .done = toplevel_done,
    .title = ignore_toplevel_text,
    .app_id = ignore_toplevel_text,
    .identifier = toplevel_identifier,
};

static void list_toplevel(void *data, struct ext_foreign_toplevel_list_v1 *list UNUSED,
                          struct ext_foreign_toplevel_handle_v1 *handle) {
    struct worker *worker = data;
    if (!worker->discovering || ext_foreign_toplevel_handle_v1_add_listener(handle, &toplevel_listener, worker) < 0)
        ext_foreign_toplevel_handle_v1_destroy(handle);
}

static void list_finished(void *data, struct ext_foreign_toplevel_list_v1 *list UNUSED) {
    ((struct worker *)data)->list_finished = true;
}

static void shm_format(void *data, struct wl_shm *shm UNUSED, uint32_t format) {
    ((struct worker *)data)->shm_formats |= format_mask(format);
}

static void global_added(void *data, struct wl_registry *registry, uint32_t name,
                         const char *interface, uint32_t version UNUSED) {
    static const struct wl_shm_listener shm_listener = {.format = shm_format};
    static const struct ext_foreign_toplevel_list_v1_listener list_listener = {
        .toplevel = list_toplevel,
        .finished = list_finished,
    };
    struct worker *worker = data;
    if (!worker->shm && strcmp(interface, wl_shm_interface.name) == 0) {
        worker->shm = wl_registry_bind(registry, name, &wl_shm_interface, 1);
        if (worker->shm)
            wl_shm_add_listener(worker->shm, &shm_listener, worker);
    } else if (!worker->list && strcmp(interface, ext_foreign_toplevel_list_v1_interface.name) == 0) {
        worker->list = wl_registry_bind(registry, name, &ext_foreign_toplevel_list_v1_interface, 1);
        if (worker->list)
            ext_foreign_toplevel_list_v1_add_listener(worker->list, &list_listener, worker);
    } else if (!worker->sources && strcmp(interface, ext_foreign_toplevel_image_capture_source_manager_v1_interface.name) == 0) {
        worker->sources = wl_registry_bind(registry, name, &ext_foreign_toplevel_image_capture_source_manager_v1_interface, 1);
    } else if (!worker->capture && strcmp(interface, ext_image_copy_capture_manager_v1_interface.name) == 0) {
        worker->capture = wl_registry_bind(registry, name, &ext_image_copy_capture_manager_v1_interface, 1);
    }
}

static void global_removed(void *data UNUSED, struct wl_registry *registry UNUSED, uint32_t name UNUSED) {}

static bool discover(struct worker *worker, int64_t deadline) {
    static const struct wl_registry_listener listener = {.global = global_added, .global_remove = global_removed};
    worker->registry = wl_display_get_registry(worker->display);
    if (!worker->registry)
        return false;
    worker->discovering = true;
    wl_registry_add_listener(worker->registry, &listener, worker);
    // The first sync discovers globals; the second awaits the list bound on that reply.
    const bool ok = sync_to(worker, deadline) && worker->shm && worker->list && worker->sources &&
                    worker->capture && sync_to(worker, deadline) && !worker->list_finished;
    worker->discovering = false;
    return ok;
}

static void destroy_local(void *proxy) {
    if (proxy)
        wl_proxy_destroy(proxy);
}

static void disconnect(struct worker *worker) {
    // Closing the connection destroys the server's objects without another roundtrip.
    for (size_t i = 0; i < worker->count; ++i)
        destroy_local(worker->requests[i].handle);
    destroy_local(worker->list);
    destroy_local(worker->sources);
    destroy_local(worker->capture);
    destroy_local(worker->shm);
    destroy_local(worker->registry);
    wl_display_disconnect(worker->display);
}

static void buffer_size(void *data, struct ext_image_copy_capture_session_v1 *session UNUSED,
                        uint32_t width, uint32_t height) {
    struct capture_state *state = data;
    state->pending.width = width;
    state->pending.height = height;
}

static void buffer_format(void *data, struct ext_image_copy_capture_session_v1 *session UNUSED,
                          uint32_t format) {
    ((struct capture_state *)data)->pending.formats |= format_mask(format);
}

static void ignore_device(void *data UNUSED, struct ext_image_copy_capture_session_v1 *session UNUSED,
                          struct wl_array *device UNUSED) {}
static void ignore_modifiers(void *data UNUSED, struct ext_image_copy_capture_session_v1 *session UNUSED,
                             uint32_t format UNUSED, struct wl_array *modifiers UNUSED) {}

static void constraints_done(void *data, struct ext_image_copy_capture_session_v1 *session UNUSED) {
    struct capture_state *state = data;
    state->constraints = state->pending;
    state->pending = (struct constraints){0};
    state->have_constraints = true;
}

static void session_stopped(void *data, struct ext_image_copy_capture_session_v1 *session UNUSED) {
    ((struct capture_state *)data)->failed = true;
}

static const struct ext_image_copy_capture_session_v1_listener session_listener = {
    .buffer_size = buffer_size,
    .shm_format = buffer_format,
    .dmabuf_device = ignore_device,
    .dmabuf_format = ignore_modifiers,
    .done = constraints_done,
    .stopped = session_stopped,
};

static void frame_transform(void *data, struct ext_image_copy_capture_frame_v1 *frame UNUSED,
                            uint32_t transform) {
    ((struct capture_state *)data)->transform = transform;
}
static void ignore_damage(void *data UNUSED, struct ext_image_copy_capture_frame_v1 *frame UNUSED,
                          int32_t x UNUSED, int32_t y UNUSED, int32_t width UNUSED, int32_t height UNUSED) {}
static void ignore_presentation(void *data UNUSED, struct ext_image_copy_capture_frame_v1 *frame UNUSED,
                                uint32_t high UNUSED, uint32_t low UNUSED, uint32_t nanos UNUSED) {}

static void frame_ready(void *data, struct ext_image_copy_capture_frame_v1 *frame UNUSED) {
    ((struct capture_state *)data)->ready = true;
}

static void frame_failed(void *data, struct ext_image_copy_capture_frame_v1 *frame UNUSED,
                         uint32_t reason UNUSED) {
    ((struct capture_state *)data)->failed = true;
}

static const struct ext_image_copy_capture_frame_v1_listener frame_listener = {
    .transform = frame_transform,
    .damage = ignore_damage,
    .presentation_time = ignore_presentation,
    .ready = frame_ready,
    .failed = frame_failed,
};

static struct wl_buffer *allocate_buffer(struct wl_shm *shm, struct image *image) {
    const int fd = memfd_create("shade-window-thumbnail", MFD_CLOEXEC | MFD_ALLOW_SEALING);
    if (fd < 0)
        return NULL;
    struct wl_buffer *buffer = NULL;
    if (ftruncate(fd, (off_t)image->bytes) == 0 &&
        fcntl(fd, F_ADD_SEALS, F_SEAL_SHRINK | F_SEAL_GROW | F_SEAL_SEAL) == 0) {
        void *pixels = mmap(NULL, image->bytes, PROT_READ, MAP_SHARED, fd, 0);
        if (pixels != MAP_FAILED) {
            struct wl_shm_pool *pool = wl_shm_create_pool(shm, fd, (int32_t)image->bytes);
            if (pool) {
                buffer = wl_shm_pool_create_buffer(pool, 0, image->width, image->height,
                                                   image->stride, image->format->shm);
                wl_shm_pool_destroy(pool);
            }
            if (buffer)
                image->pixels = pixels;
            else
                munmap(pixels, image->bytes);
        }
    }
    close(fd);
    return buffer;
}

static bool capture_window(struct worker *worker, const struct request *request,
                           int64_t deadline, struct image *image) {
    struct ext_image_capture_source_v1 *source =
        ext_foreign_toplevel_image_capture_source_manager_v1_create_source(worker->sources, request->handle);
    if (!source)
        return false;
    // No paint_cursors option: only the exact toplevel contents are requested.
    struct ext_image_copy_capture_session_v1 *session =
        ext_image_copy_capture_manager_v1_create_session(worker->capture, source, 0);
    struct ext_image_copy_capture_frame_v1 *frame = NULL;
    struct wl_buffer *buffer = NULL;
    struct capture_state state = {.transform = UINT32_MAX};
    bool ok = false;
    if (!session || ext_image_copy_capture_session_v1_add_listener(session, &session_listener, &state) < 0 ||
        !wait_for(worker, &state.have_constraints, &state.failed, deadline) || !request->handle)
        goto cleanup;

    const struct constraints *constraints = &state.constraints;
    if (!constraints->width || !constraints->height ||
        constraints->width > MAX_CAPTURE_EDGE || constraints->height > MAX_CAPTURE_EDGE)
        goto cleanup;
    image->width = (int32_t)constraints->width;
    image->height = (int32_t)constraints->height;
    image->stride = image->width * 4;
    image->bytes = (size_t)image->stride * image->height;
    if (image->bytes > MAX_CAPTURE_BYTES)
        goto cleanup;

    const unsigned supported = constraints->formats & worker->shm_formats;
    if (!supported)
        goto cleanup;
    image->format = &formats[__builtin_ctz(supported)];
    buffer = allocate_buffer(worker->shm, image);
    if (!buffer)
        goto cleanup;
    frame = ext_image_copy_capture_session_v1_create_frame(session);
    if (!frame || ext_image_copy_capture_frame_v1_add_listener(frame, &frame_listener, &state) < 0)
        goto cleanup;
    ext_image_copy_capture_frame_v1_attach_buffer(frame, buffer);
    ext_image_copy_capture_frame_v1_damage_buffer(frame, 0, 0, image->width, image->height);
    ext_image_copy_capture_frame_v1_capture(frame);
    ok = wait_for(worker, &state.ready, &state.failed, deadline) && request->handle &&
         state.transform <= WL_OUTPUT_TRANSFORM_FLIPPED_270;
    image->transform = state.transform;

cleanup:
    if (frame)
        ext_image_copy_capture_frame_v1_destroy(frame);
    if (session)
        ext_image_copy_capture_session_v1_destroy(session);
    ext_image_capture_source_v1_destroy(source);
    if (buffer)
        wl_buffer_destroy(buffer);
    return ok;
}

struct image_view {
    const uint8_t *origin;
    ptrdiff_t dx;
    ptrdiff_t dy;
    unsigned width;
    unsigned height;
};

static struct image_view upright(const struct image *image) {
    const ptrdiff_t x = 4, y = image->stride;
    const ptrdiff_t right = (image->width - 1) * x;
    const ptrdiff_t bottom = (image->height - 1) * y;
    const uint8_t *origin = image->pixels;
    const unsigned w = (unsigned)image->width, h = (unsigned)image->height;
    // Map upright coordinates to the compositor-transformed buffer, not vice versa.
    switch (image->transform) {
    case WL_OUTPUT_TRANSFORM_90: return (struct image_view){origin + bottom, -y, x, h, w};
    case WL_OUTPUT_TRANSFORM_180: return (struct image_view){origin + bottom + right, -x, -y, w, h};
    case WL_OUTPUT_TRANSFORM_270: return (struct image_view){origin + right, y, -x, h, w};
    case WL_OUTPUT_TRANSFORM_FLIPPED: return (struct image_view){origin + right, -x, y, w, h};
    case WL_OUTPUT_TRANSFORM_FLIPPED_90: return (struct image_view){origin, y, x, h, w};
    case WL_OUTPUT_TRANSFORM_FLIPPED_180: return (struct image_view){origin + bottom, x, -y, w, h};
    case WL_OUTPUT_TRANSFORM_FLIPPED_270: return (struct image_view){origin + bottom + right, -y, -x, h, w};
    default: return (struct image_view){origin, x, y, w, h};
    }
}

static unsigned straight_channel(unsigned color, unsigned alpha) {
    if (!alpha)
        return 0;
    const unsigned straight = (color * 255 + alpha / 2) / alpha;
    return straight > 255 ? 255 : straight;
}

static void read_pixel(uint8_t *out, const uint8_t *pixel, const struct pixel_format *format) {
    unsigned low, green, high, alpha = 255;
    if (format->ten_bit) {
        const uint32_t word = (uint32_t)pixel[0] | (uint32_t)pixel[1] << 8 |
                              (uint32_t)pixel[2] << 16 | (uint32_t)pixel[3] << 24;
        low = (word >> 2) & 255;
        green = (word >> 12) & 255;
        high = (word >> 22) & 255;
        if (format->alpha)
            alpha = (word >> 30) * 85;
    } else {
        low = pixel[0];
        green = pixel[1];
        high = pixel[2];
        if (format->alpha)
            alpha = pixel[3];
    }
    if (alpha != 255) {
        low = straight_channel(low, alpha);
        green = straight_channel(green, alpha);
        high = straight_channel(high, alpha);
    }
    out[0] = (uint8_t)(format->red_low ? low : high);
    out[1] = (uint8_t)green;
    out[2] = (uint8_t)(format->red_low ? high : low);
    if (format->alpha)
        out[3] = (uint8_t)alpha;
}

static bool encode_thumbnail(FILE *file, const struct image *image) {
    png_structp png = png_create_write_struct(PNG_LIBPNG_VER_STRING, NULL, NULL, NULL);
    if (!png)
        return false;
    png_infop info = png_create_info_struct(png);
    if (!info || setjmp(png_jmpbuf(png))) {
        png_destroy_write_struct(&png, &info);
        return false;
    }
    const struct image_view view = upright(image);
    const unsigned longest = view.width > view.height ? view.width : view.height;
    const unsigned divisor = longest > THUMBNAIL_EDGE ? longest : THUMBNAIL_EDGE;
    unsigned width = (view.width * THUMBNAIL_EDGE + divisor / 2) / divisor;
    unsigned height = (view.height * THUMBNAIL_EDGE + divisor / 2) / divisor;
    if (!width)
        width = 1;
    if (!height)
        height = 1;
    const bool alpha = image->format->alpha;
    const unsigned channels = alpha ? 4 : 3;
    png_init_io(png, file);
    png_set_compression_level(png, 1);
    png_set_IHDR(png, info, width, height, 8, alpha ? PNG_COLOR_TYPE_RGBA : PNG_COLOR_TYPE_RGB,
                 PNG_INTERLACE_NONE, PNG_COMPRESSION_TYPE_DEFAULT, PNG_FILTER_TYPE_DEFAULT);
    png_write_info(png, info);

    // Sample the center of each thumbnail pixel directly from SHM; no full-size copy.
    ptrdiff_t columns[THUMBNAIL_EDGE];
    for (unsigned x = 0; x < width; ++x)
        columns[x] = (ptrdiff_t)((2 * x + 1) * view.width / (2 * width)) * view.dx;
    uint8_t row[THUMBNAIL_EDGE * 4];
    for (unsigned y = 0; y < height; ++y) {
        const uint8_t *source = view.origin +
            (ptrdiff_t)((2 * y + 1) * view.height / (2 * height)) * view.dy;
        for (unsigned x = 0; x < width; ++x)
            read_pixel(row + x * channels, source + columns[x], image->format);
        png_write_row(png, row);
    }
    png_write_end(png, info);
    png_destroy_write_struct(&png, &info);
    return true;
}

static void save_thumbnail(const struct image *image, const char *path) {
    static const char suffix[] = ".shade-window-thumbnail-XXXXXX";
    char temporary[PATH_MAX];
    const char *slash = strrchr(path, '/');
    const size_t prefix = slash ? (size_t)(slash - path) + 1 : 0;
    if (prefix > sizeof(temporary) - sizeof(suffix))
        return;
    memcpy(temporary, path, prefix);
    memcpy(temporary + prefix, suffix, sizeof(suffix));
    const int fd = mkostemp(temporary, O_CLOEXEC);
    if (fd < 0)
        return;
    FILE *file = fdopen(fd, "wb");
    if (file) {
        const bool written = encode_thumbnail(file, image);
        if (fclose(file) == 0 && written &&
            renameat2(AT_FDCWD, temporary, AT_FDCWD, path, RENAME_NOREPLACE) == 0)
            return;
    } else {
        close(fd);
    }
    unlink(temporary);
}

static bool parse_requests(struct worker *worker, int argc, char **argv) {
    if (argc < 3 || (argc - 1) % 2 != 0 || (argc - 1) / 2 > MAX_REQUESTS)
        return false;
    worker->count = (size_t)(argc - 1) / 2;
    for (size_t i = 0; i < worker->count; ++i) {
        struct request *request = &worker->requests[i];
        request->identifier = argv[2 * i + 1];
        request->path = argv[2 * i + 2];
        request->owner = i;
        const size_t length = strnlen(request->identifier, 33);
        if (!length || length > 32 || !*request->path)
            return false;
        for (size_t k = 0; k < length; ++k)
            if (!((request->identifier[k] >= '0' && request->identifier[k] <= '9') ||
                  (request->identifier[k] >= 'a' && request->identifier[k] <= 'f')))
                return false;
        for (size_t k = 0; k < i; ++k) {
            const struct request *earlier = &worker->requests[k];
            if (strcmp(request->path, earlier->path) == 0)
                return false;
            if (earlier->owner == k && strcmp(request->identifier, earlier->identifier) == 0)
                request->owner = k;
        }
    }
    return true;
}

int main(int argc, char **argv) {
    struct worker worker = {0};
    if (!parse_requests(&worker, argc, argv)) {
        fputs("usage: shade-window-thumbnail stableId output.png [stableId output.png ...]\n", stderr);
        return 2;
    }
    const int64_t start = monotonic_ms();
    if (start < 0)
        return EXIT_FAILURE;
    // poll bounds protocol waits; the alarm also covers a stuck socket connect or write.
    // exec preserves ignored signals and the parent's mask; do not inherit an
    // ignored or blocked SIGALRM from the UI process.
    sigset_t alarms;
    sigemptyset(&alarms);
    sigaddset(&alarms, SIGALRM);
    if (signal(SIGALRM, SIG_DFL) == SIG_ERR || sigprocmask(SIG_UNBLOCK, &alarms, NULL) < 0)
        return EXIT_FAILURE;
    alarm((BATCH_TIMEOUT_MS + 999) / 1000);
    for (size_t i = 0; i < worker.count; ++i)
        if (unlink(worker.requests[i].path) < 0 && errno != ENOENT)
            return EXIT_FAILURE;
    worker.display = wl_display_connect(NULL);
    if (!worker.display)
        return EXIT_FAILURE;
    const bool discovered = discover(&worker, start + DISCOVERY_TIMEOUT_MS);
    const int64_t batch_deadline = start + BATCH_TIMEOUT_MS;
    for (size_t i = 0; discovered && !worker.disconnected && !worker.list_finished && i < worker.count; ++i) {
        const struct request *request = &worker.requests[i];
        if (!request->listed)
            continue;
        const int64_t now = monotonic_ms();
        if (now < 0 || now >= batch_deadline)
            break;
        const int64_t frame_deadline = now + FRAME_TIMEOUT_MS;
        struct image image = {0};
        if (capture_window(&worker, request, frame_deadline < batch_deadline ? frame_deadline : batch_deadline, &image)) {
            for (size_t k = i; k < worker.count; ++k) {
                if (worker.requests[k].owner != i)
                    continue;
                const int64_t before_write = monotonic_ms();
                if (before_write < 0 || before_write >= batch_deadline)
                    break;
                save_thumbnail(&image, worker.requests[k].path);
            }
        }
        if (image.pixels)
            munmap(image.pixels, image.bytes);
    }
    disconnect(&worker);
    // Per-window results are signalled by the presence of each fresh output file.
    return discovered ? EXIT_SUCCESS : EXIT_FAILURE;
}
