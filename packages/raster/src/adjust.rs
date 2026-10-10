//! Brightness, contrast, gamma and invert, applied to a grayscale buffer before dithering.

use image::GrayImage;

/// UI-facing ranges: brightness and contrast -100..100 (0 = unchanged), gamma 0.1..5
/// (1 = unchanged). Values outside the ranges are clamped.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Adjustments {
    pub brightness: f64,
    pub contrast: f64,
    pub gamma: f64,
    pub invert: bool,
}

impl Default for Adjustments {
    fn default() -> Self {
        Adjustments {
            brightness: 0.0,
            contrast: 0.0,
            gamma: 1.0,
            invert: false,
        }
    }
}

impl Adjustments {
    /// A 256-entry lookup table so applying is one table read per pixel.
    fn build_lut(&self) -> [u8; 256] {
        let brightness = self.brightness.clamp(-100.0, 100.0) / 100.0 * 255.0;
        // Contrast -100..100 maps to a factor 0..4 around mid-grey (0 -> 1.0).
        let c = (self.contrast.clamp(-100.0, 100.0) + 100.0) / 100.0;
        let contrast = c * c;
        let gamma = self.gamma.clamp(0.1, 5.0);

        let mut lut = [0u8; 256];
        for (i, slot) in lut.iter_mut().enumerate() {
            let mut v = i as f64 + brightness;
            v = ((v - 128.0) * contrast + 128.0).clamp(0.0, 255.0);
            v = 255.0 * (v / 255.0).powf(1.0 / gamma);
            *slot = v.clamp(0.0, 255.0).round() as u8;
        }
        lut
    }

    pub fn apply(&self, image: &GrayImage) -> GrayImage {
        let lut = self.build_lut();
        let mut out = image.clone();
        for p in out.pixels_mut() {
            let v = lut[p.0[0] as usize];
            p.0[0] = if self.invert { 255 - v } else { v };
        }
        out
    }
}

/// How many times the detail (a pixel minus the average of its 3 x 3 neighbourhood) is added back
/// at the largest sharpen setting.
const SHARPEN_MAX_GAIN: f64 = 3.0;

/// Sharpens `image`: every pixel is pushed away from the average of its 3 x 3 neighbourhood, which
/// makes edges crisper. `amount` runs from 0 (off) to 100 (strong); anything that is not a number,
/// or is 0 or less, leaves the image as it is, and anything above 100 counts as 100. The edge of
/// the picture is treated as if its outermost pixels carried on.
///
/// Apply it after `Adjustments`, at the resolution that will be engraved.
pub fn sharpen(image: &GrayImage, amount: f64) -> GrayImage {
    let mut out = image.clone();
    let (w, h) = image.dimensions();
    if !amount.is_finite() || amount <= 0.0 || w == 0 || h == 0 {
        return out;
    }
    let gain = amount.min(100.0) / 100.0 * SHARPEN_MAX_GAIN;
    let (wi, hi) = (i64::from(w), i64::from(h));
    let at = |x: i64, y: i64| -> f64 {
        let (cx, cy) = (x.clamp(0, wi - 1), y.clamp(0, hi - 1));
        f64::from(image.get_pixel(cx as u32, cy as u32).0[0])
    };
    for y in 0..hi {
        for x in 0..wi {
            let mut sum = 0.0;
            for dy in -1..=1 {
                for dx in -1..=1 {
                    sum += at(x + dx, y + dy);
                }
            }
            let here = at(x, y);
            let sharpened = (here + gain * (here - sum / 9.0)).clamp(0.0, 255.0);
            out.put_pixel(x as u32, y as u32, image::Luma([sharpened.round() as u8]));
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::Luma;

    fn solid(v: u8) -> GrayImage {
        GrayImage::from_pixel(4, 4, Luma([v]))
    }

    fn sharpen_edge() -> GrayImage {
        GrayImage::from_fn(8, 8, |x, _| Luma([if x < 4 { 100 } else { 200 }]))
    }

    fn at(image: &GrayImage, x: u32, y: u32) -> u8 {
        image.get_pixel(x, y).0[0]
    }

    #[test]
    fn sharpen_of_zero_negative_or_not_a_number_changes_nothing() {
        let edge = sharpen_edge();
        for amount in [0.0, -5.0, f64::NAN, f64::INFINITY, f64::NEG_INFINITY] {
            assert_eq!(sharpen(&edge, amount), edge, "{amount}");
        }
    }

    #[test]
    fn sharpen_leaves_a_flat_image_alone() {
        assert_eq!(sharpen(&solid(100), 100.0), solid(100));
    }

    #[test]
    fn sharpen_darkens_the_dark_side_of_an_edge_and_lightens_the_light_side() {
        let out = sharpen(&sharpen_edge(), 50.0);
        assert_eq!(at(&out, 3, 4), 50);
        assert_eq!(at(&out, 4, 4), 250);
        // Away from the edge nothing changes.
        assert_eq!(at(&out, 0, 4), 100);
        assert_eq!(at(&out, 7, 4), 200);
    }

    #[test]
    fn sharpen_clamps_to_the_range_of_a_pixel() {
        let out = sharpen(&sharpen_edge(), 100.0);
        assert_eq!(at(&out, 3, 4), 0);
        assert_eq!(at(&out, 4, 4), 255);
        // More than 100 counts as 100.
        assert_eq!(sharpen(&sharpen_edge(), 5000.0), out);
    }

    #[test]
    fn sharpen_keeps_the_size_and_copes_with_tiny_and_empty_images() {
        assert_eq!(sharpen(&sharpen_edge(), 30.0).dimensions(), (8, 8));
        assert_eq!(sharpen(&solid(7), 100.0).dimensions(), (4, 4));
        let one = GrayImage::from_pixel(1, 1, Luma([90]));
        assert_eq!(sharpen(&one, 100.0), one);
        let thin = GrayImage::from_fn(2, 1, |x, _| Luma([if x == 0 { 10 } else { 240 }]));
        assert_eq!(sharpen(&thin, 100.0).dimensions(), (2, 1));
        let empty = GrayImage::new(0, 0);
        assert_eq!(sharpen(&empty, 100.0).dimensions(), (0, 0));
    }

    #[test]
    fn sharpen_pushes_a_thin_dark_line_darker_and_its_sides_lighter() {
        let line = GrayImage::from_fn(9, 9, |x, _| Luma([if x == 4 { 60 } else { 120 }]));
        let out = sharpen(&line, 40.0);
        assert!(at(&out, 4, 4) < 60, "{}", at(&out, 4, 4));
        assert!(at(&out, 3, 4) > 120, "{}", at(&out, 3, 4));
        assert_eq!(at(&out, 0, 4), 120);
    }

    #[test]
    fn defaults_leave_the_image_unchanged() {
        for v in [0u8, 1, 64, 128, 200, 255] {
            assert_eq!(
                Adjustments::default().apply(&solid(v)).get_pixel(0, 0).0[0],
                v
            );
        }
    }

    #[test]
    fn brightness_lightens() {
        let a = Adjustments {
            brightness: 50.0,
            ..Default::default()
        };
        assert!(a.apply(&solid(100)).get_pixel(0, 0).0[0] > 100);
    }

    #[test]
    fn contrast_pushes_values_away_from_mid_grey() {
        let a = Adjustments {
            contrast: 50.0,
            ..Default::default()
        };
        assert!(a.apply(&solid(200)).get_pixel(0, 0).0[0] > 200);
        assert!(a.apply(&solid(60)).get_pixel(0, 0).0[0] < 60);
    }

    #[test]
    fn gamma_above_one_lightens_midtones() {
        let a = Adjustments {
            gamma: 2.2,
            ..Default::default()
        };
        assert!(a.apply(&solid(128)).get_pixel(0, 0).0[0] > 128);
    }

    #[test]
    fn invert_flips_extremes() {
        let a = Adjustments {
            invert: true,
            ..Default::default()
        };
        assert_eq!(a.apply(&solid(0)).get_pixel(0, 0).0[0], 255);
        assert_eq!(a.apply(&solid(255)).get_pixel(0, 0).0[0], 0);
    }

    #[test]
    fn out_of_range_inputs_are_clamped_not_panicking() {
        let a = Adjustments {
            brightness: 1e9,
            contrast: -1e9,
            gamma: -5.0,
            invert: false,
        };
        let _ = a.apply(&solid(128));
    }
}
