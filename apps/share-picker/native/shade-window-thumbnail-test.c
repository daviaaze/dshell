#define main worker_main
#include "shade-window-thumbnail.c"
#undef main

#include <assert.h>

static bool accepts(int argc, char **argv) {
    struct worker worker = {0};
    return parse_requests(&worker, argc, argv);
}

static void test_requests(void) {
    char *single[] = {"shade-window-thumbnail", "a019ef", "window.png"};
    assert(accepts(3, single));
    assert(!accepts(1, single));
    assert(!accepts(2, single));
    char *invalid[] = {"", "0xabc", "ABC", "g", "-1", "a b", "a/b",
                       "0123456789abcdef0123456789abcdef0"};
    for (size_t i = 0; i < sizeof(invalid) / sizeof(invalid[0]); ++i) {
        single[1] = invalid[i];
        assert(!accepts(3, single));
    }
    single[1] = "0123456789abcdef0123456789abcdef";
    assert(accepts(3, single));
    single[2] = "";
    assert(!accepts(3, single));

    char *duplicates[] = {"shade-window-thumbnail", "01", "one.png", "01", "two.png"};
    struct worker worker = {0};
    assert(parse_requests(&worker, 5, duplicates));
    assert(worker.requests[1].owner == 0);
    duplicates[3] = "1";
    assert(parse_requests(&worker, 5, duplicates));
    assert(worker.requests[1].owner == 1);
    duplicates[4] = duplicates[2];
    assert(!accepts(5, duplicates));

    char ids[MAX_REQUESTS + 1][8];
    char paths[MAX_REQUESTS + 1][16];
    char *batch[2 * (MAX_REQUESTS + 1) + 2] = {"shade-window-thumbnail"};
    for (size_t i = 0; i <= MAX_REQUESTS; ++i) {
        snprintf(ids[i], sizeof(ids[i]), "%zx", i);
        snprintf(paths[i], sizeof(paths[i]), "%zu.png", i);
        batch[2 * i + 1] = ids[i];
        batch[2 * i + 2] = paths[i];
    }
    assert(accepts(1 + 2 * MAX_REQUESTS, batch));
    assert(!accepts(1 + 2 * (MAX_REQUESTS + 1), batch));
}

static void test_pixel_formats(void) {
    for (size_t i = 0; i < sizeof(formats) / sizeof(formats[0]); ++i) {
        const struct pixel_format *format = &formats[i];
        const uint32_t word = format->ten_bit
            ? UINT32_C(256) | UINT32_C(512) << 10 | UINT32_C(1023) << 20 | UINT32_C(3) << 30
            : UINT32_C(0xfffe8040);
        const uint8_t pixel[] = {word & 255, (word >> 8) & 255, (word >> 16) & 255, word >> 24};
        uint8_t rgba[4] = {0, 0, 0, 255};
        read_pixel(rgba, pixel, format);
        const unsigned high = format->ten_bit ? 255 : 254;
        assert(rgba[0] == (format->red_low ? 64 : high));
        assert(rgba[1] == 128);
        assert(rgba[2] == (format->red_low ? high : 64));
        assert(rgba[3] == 255);
        assert(format_mask(format->shm) == 1u << i);
    }
    assert(format_mask(UINT32_MAX) == 0);
    const uint8_t premultiplied[] = {10, 20, 30, 85};
    uint8_t rgba[4];
    read_pixel(rgba, premultiplied, &formats[0]);
    assert(rgba[0] == 90 && rgba[1] == 60 && rgba[2] == 30 && rgba[3] == 85);
    const uint8_t transparent[] = {0, 0, 0, 0};
    read_pixel(rgba, transparent, &formats[0]);
    assert(rgba[0] == 0 && rgba[1] == 0 && rgba[2] == 0 && rgba[3] == 0);
}

static png_image roundtrip(const struct image *image, uint8_t **pixels) {
    FILE *file = tmpfile();
    assert(file);
    assert(encode_thumbnail(file, image));
    rewind(file);
    png_image decoded = {.version = PNG_IMAGE_VERSION};
    assert(png_image_begin_read_from_stdio(&decoded, file));
    decoded.format = PNG_FORMAT_RGBA;
    *pixels = malloc(PNG_IMAGE_SIZE(decoded));
    assert(*pixels);
    assert(png_image_finish_read(&decoded, NULL, *pixels, 0, NULL));
    assert(fclose(file) == 0);
    return decoded;
}

static void test_transforms(void) {
    uint8_t pixels[6 * 4];
    for (unsigned i = 0; i < 6; ++i) {
        pixels[4 * i] = pixels[4 * i + 1] = pixels[4 * i + 2] = (uint8_t)(i + 1);
        pixels[4 * i + 3] = 255;
    }
    const uint8_t expected[][6] = {
        {1, 2, 3, 4, 5, 6},
        {5, 3, 1, 6, 4, 2},
        {6, 5, 4, 3, 2, 1},
        {2, 4, 6, 1, 3, 5},
        {2, 1, 4, 3, 6, 5},
        {1, 3, 5, 2, 4, 6},
        {5, 6, 3, 4, 1, 2},
        {6, 4, 2, 5, 3, 1},
    };
    struct image image = {.format = &formats[0], .pixels = pixels,
                          .bytes = sizeof(pixels), .width = 2, .height = 3, .stride = 8};
    for (uint32_t transform = 0; transform <= WL_OUTPUT_TRANSFORM_FLIPPED_270; ++transform) {
        image.transform = transform;
        uint8_t *decoded_pixels;
        png_image decoded = roundtrip(&image, &decoded_pixels);
        assert(decoded.width == (transform & 1 ? 3u : 2u));
        assert(decoded.height == (transform & 1 ? 2u : 3u));
        for (unsigned i = 0; i < 6; ++i) {
            assert(decoded_pixels[4 * i] == expected[transform][i]);
            assert(decoded_pixels[4 * i + 1] == expected[transform][i]);
            assert(decoded_pixels[4 * i + 2] == expected[transform][i]);
            assert(decoded_pixels[4 * i + 3] == 255);
        }
        free(decoded_pixels);
        png_image_free(&decoded);
    }
}

static void test_dimensions(void) {
    const unsigned cases[][4] = {
        {641, 321, 320, 160},
        {321, 641, 160, 320},
        {3, 1, 3, 1},
        {8192, 1, 320, 1},
    };
    for (size_t i = 0; i < sizeof(cases) / sizeof(cases[0]); ++i) {
        struct image image = {.format = &formats[2], .width = (int32_t)cases[i][0],
                              .height = (int32_t)cases[i][1], .transform = WL_OUTPUT_TRANSFORM_NORMAL};
        image.stride = image.width * 4;
        image.bytes = (size_t)image.stride * image.height;
        image.pixels = calloc(1, image.bytes);
        assert(image.pixels);
        uint8_t *decoded_pixels;
        png_image decoded = roundtrip(&image, &decoded_pixels);
        assert(decoded.width == cases[i][2] && decoded.height == cases[i][3]);
        free(decoded_pixels);
        png_image_free(&decoded);
        free(image.pixels);
    }
}

static void test_publication(void) {
    char directory[] = "/tmp/shade-window-thumbnail-test-XXXXXX";
    assert(mkdtemp(directory));
    char path[PATH_MAX];
    const int length = snprintf(path, sizeof(path), "%s/result.png", directory);
    assert(length > 0 && (size_t)length < sizeof(path));
    uint8_t pixel[] = {0, 0, 255, 255};
    const struct image image = {.format = &formats[0], .pixels = pixel, .bytes = 4,
                                .width = 1, .height = 1, .stride = 4,
                                .transform = WL_OUTPUT_TRANSFORM_NORMAL};
    save_thumbnail(&image, path);
    png_image decoded = {.version = PNG_IMAGE_VERSION};
    assert(png_image_begin_read_from_file(&decoded, path));
    decoded.format = PNG_FORMAT_RGBA;
    uint8_t rgba[4];
    assert(png_image_finish_read(&decoded, NULL, rgba, 0, NULL));
    assert(rgba[0] == 255 && rgba[1] == 0 && rgba[2] == 0 && rgba[3] == 255);
    png_image_free(&decoded);

    // The worker owns its supplied output paths: a failed new capture removes stale pixels.
    assert(unsetenv("WAYLAND_SOCKET") == 0);
    assert(setenv("XDG_RUNTIME_DIR", directory, 1) == 0);
    assert(setenv("WAYLAND_DISPLAY", "missing-wayland-socket", 1) == 0);
    char *args[] = {"shade-window-thumbnail", "f", path};
    assert(worker_main(3, args) == EXIT_FAILURE);
    alarm(0);
    assert(access(path, F_OK) == -1 && errno == ENOENT);
    assert(rmdir(directory) == 0);
}

int main(void) {
    test_requests();
    test_pixel_formats();
    test_transforms();
    test_dimensions();
    test_publication();
    puts("native thumbnail tests passed");
    return EXIT_SUCCESS;
}
