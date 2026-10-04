//! Image decoding, resampling and PNG encoding helpers.

use image::{GrayImage, ImageError, Luma};

/// Decodes PNG/JPG/JPEG/BMP bytes to 8-bit grayscale. Transparent pixels are composited
/// onto white first, so a transparent background never burns as black.
pub fn load_grayscale(bytes: &[u8]) -> Result<GrayImage, ImageError> {
    let rgba = image::load_from_memory(bytes)?.to_rgba8();
    let (w, h) = rgba.dimensions();
    let mut out = GrayImage::new(w, h);
    for (x, y, p) in rgba.enumerate_pixels() {
        let [r, g, b, a] = p.0;
        let luma = 0.299 * r as f64 + 0.587 * g as f64 + 0.114 * b as f64;
        let alpha = a as f64 / 255.0;
        let v = luma * alpha + 255.0 * (1.0 - alpha);
        out.put_pixel(x, y, Luma([v.round().clamp(0.0, 255.0) as u8]));
    }
    Ok(out)
}

/// Encodes a grayscale buffer as PNG bytes.
pub fn encode_png(image: &GrayImage) -> Result<Vec<u8>, ImageError> {
    let mut bytes: Vec<u8> = Vec::new();
    image.write_to(
        &mut std::io::Cursor::new(&mut bytes),
        image::ImageFormat::Png,
    )?;
    Ok(bytes)
}

/// Bilinear/triangle resize.
pub fn resize_grayscale(image: &GrayImage, width: u32, height: u32) -> GrayImage {
    image::imageops::resize(
        image,
        width.max(1),
        height.max(1),
        image::imageops::FilterType::Triangle,
    )
}

/// Result of [`resample`]: the sampled image plus a mask of which output pixels fell
/// inside the source image (outside pixels are white and must never burn).
pub struct Resampled {
    pub image: GrayImage,
    pub inside: Vec<bool>,
}

/// Resamples `src` into an `out_w` x `out_h` grid. `map(x, y)` returns the **source pixel
/// coordinates** (fractional, pixel `i` covering `[i, i+1)`) of the centre of output pixel
/// `(x, y)`; this is how an arbitrary affine placement (rotation, mirroring, scaling) is
/// applied without ever rasterising a rotated bitmap first.
pub fn resample<F>(src: &GrayImage, out_w: u32, out_h: u32, map: F) -> Resampled
where
    F: Fn(u32, u32) -> (f64, f64),
{
    let (sw, sh) = src.dimensions();
    let mut image = GrayImage::from_pixel(out_w, out_h, Luma([255]));
    let mut inside = vec![false; out_w as usize * out_h as usize];
    if sw == 0 || sh == 0 {
        return Resampled { image, inside };
    }
    for y in 0..out_h {
        for x in 0..out_w {
            let (u, v) = map(x, y);
            if !(u >= 0.0 && v >= 0.0 && u < sw as f64 && v < sh as f64) {
                continue;
            }
            let (fx, fy) = (u - 0.5, v - 0.5);
            let x0 = fx.floor().max(0.0) as u32;
            let y0 = fy.floor().max(0.0) as u32;
            let x1 = (x0 + 1).min(sw - 1);
            let y1 = (y0 + 1).min(sh - 1);
            let tx = (fx - x0 as f64).clamp(0.0, 1.0);
            let ty = (fy - y0 as f64).clamp(0.0, 1.0);
            let p = |px: u32, py: u32| src.get_pixel(px, py).0[0] as f64;
            let top = p(x0, y0) * (1.0 - tx) + p(x1, y0) * tx;
            let bottom = p(x0, y1) * (1.0 - tx) + p(x1, y1) * tx;
            let value = top * (1.0 - ty) + bottom * ty;
            image.put_pixel(x, y, Luma([value.round().clamp(0.0, 255.0) as u8]));
            inside[y as usize * out_w as usize + x as usize] = true;
        }
    }
    Resampled { image, inside }
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::{Rgba, RgbaImage};

    #[test]
    fn png_round_trip() {
        let img = GrayImage::from_pixel(4, 4, Luma([200]));
        let decoded = load_grayscale(&encode_png(&img).unwrap()).unwrap();
        assert_eq!(decoded.dimensions(), (4, 4));
        assert_eq!(decoded.get_pixel(0, 0).0[0], 200);
    }

    #[test]
    fn transparent_pixels_become_white() {
        let mut rgba = RgbaImage::new(2, 1);
        rgba.put_pixel(0, 0, Rgba([0, 0, 0, 0])); // fully transparent black
        rgba.put_pixel(1, 0, Rgba([0, 0, 0, 255])); // opaque black
        let mut png = Vec::new();
        rgba.write_to(&mut std::io::Cursor::new(&mut png), image::ImageFormat::Png)
            .unwrap();
        let g = load_grayscale(&png).unwrap();
        assert_eq!(g.get_pixel(0, 0).0[0], 255);
        assert_eq!(g.get_pixel(1, 0).0[0], 0);
    }

    #[test]
    fn identity_resample_reproduces_the_source() {
        let src = GrayImage::from_fn(4, 4, |x, y| Luma([(x * 40 + y * 10) as u8]));
        let r = resample(&src, 4, 4, |x, y| (x as f64 + 0.5, y as f64 + 0.5));
        assert_eq!(r.image, src);
        assert!(r.inside.iter().all(|b| *b));
    }

    #[test]
    fn samples_outside_the_source_are_white_and_masked() {
        let src = GrayImage::from_pixel(2, 2, Luma([0]));
        let r = resample(&src, 4, 1, |x, _| (x as f64 - 1.0 + 0.5, 0.5));
        assert!(!r.inside[0]);
        assert_eq!(r.image.get_pixel(0, 0).0[0], 255);
        assert!(r.inside[1] && r.inside[2]);
        assert_eq!(r.image.get_pixel(1, 0).0[0], 0);
    }

    #[test]
    fn mirrored_mapping_flips_the_image() {
        let src = GrayImage::from_fn(4, 1, |x, _| Luma([(x * 60) as u8]));
        let r = resample(&src, 4, 1, |x, _| (4.0 - (x as f64 + 0.5), 0.5));
        assert_eq!(r.image.get_pixel(0, 0).0[0], 180);
        assert_eq!(r.image.get_pixel(3, 0).0[0], 0);
    }
}
