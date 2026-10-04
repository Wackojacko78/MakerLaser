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

#[cfg(test)]
mod tests {
    use super::*;
    use image::Luma;

    fn solid(v: u8) -> GrayImage {
        GrayImage::from_pixel(4, 4, Luma([v]))
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
