//! Error-diffusion dithering: 8-bit grayscale in, strictly 0/255 out. Black (0) means
//! "fire the laser". All four algorithms share one engine and differ only in their kernel.

use image::GrayImage;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DitherAlgorithm {
    None,
    FloydSteinberg,
    Jarvis,
    Stucki,
    Atkinson,
}

/// `(dx, dy, weight)` entries of an error-diffusion kernel.
fn kernel(algorithm: DitherAlgorithm) -> Vec<(i32, i32, f64)> {
    match algorithm {
        DitherAlgorithm::None => vec![],
        DitherAlgorithm::FloydSteinberg => {
            let d = 16.0;
            vec![
                (1, 0, 7.0 / d),
                (-1, 1, 3.0 / d),
                (0, 1, 5.0 / d),
                (1, 1, 1.0 / d),
            ]
        }
        DitherAlgorithm::Jarvis => {
            let d = 48.0;
            vec![
                (1, 0, 7.0 / d),
                (2, 0, 5.0 / d),
                (-2, 1, 3.0 / d),
                (-1, 1, 5.0 / d),
                (0, 1, 7.0 / d),
                (1, 1, 5.0 / d),
                (2, 1, 3.0 / d),
                (-2, 2, 1.0 / d),
                (-1, 2, 3.0 / d),
                (0, 2, 5.0 / d),
                (1, 2, 3.0 / d),
                (2, 2, 1.0 / d),
            ]
        }
        DitherAlgorithm::Stucki => {
            let d = 42.0;
            vec![
                (1, 0, 8.0 / d),
                (2, 0, 4.0 / d),
                (-2, 1, 2.0 / d),
                (-1, 1, 4.0 / d),
                (0, 1, 8.0 / d),
                (1, 1, 4.0 / d),
                (2, 1, 2.0 / d),
                (-2, 2, 1.0 / d),
                (-1, 2, 2.0 / d),
                (0, 2, 4.0 / d),
                (1, 2, 2.0 / d),
                (2, 2, 1.0 / d),
            ]
        }
        // Atkinson diffuses only 6/8 of the error, which gives its higher-contrast look.
        DitherAlgorithm::Atkinson => {
            let d = 8.0;
            vec![
                (1, 0, 1.0 / d),
                (2, 0, 1.0 / d),
                (-1, 1, 1.0 / d),
                (0, 1, 1.0 / d),
                (1, 1, 1.0 / d),
                (0, 2, 1.0 / d),
            ]
        }
    }
}

/// Dithers `image` with the given kernel and `threshold` (0-255, normally 128).
pub fn dither(image: &GrayImage, algorithm: DitherAlgorithm, threshold: u8) -> GrayImage {
    let (width, height) = image.dimensions();
    let mut buffer: Vec<f64> = image.pixels().map(|p| p.0[0] as f64).collect();
    let mut out = GrayImage::new(width, height);
    let threshold = threshold as f64;
    let kernel = kernel(algorithm);
    let (w, h) = (width as i32, height as i32);

    for y in 0..h {
        for x in 0..w {
            let idx = (y * w + x) as usize;
            let old = buffer[idx].clamp(0.0, 255.0);
            let new = if old >= threshold { 255.0 } else { 0.0 };
            out.get_pixel_mut(x as u32, y as u32).0[0] = new as u8;
            let error = old - new;
            if error == 0.0 {
                continue;
            }
            for &(dx, dy, weight) in &kernel {
                let (nx, ny) = (x + dx, y + dy);
                if nx >= 0 && nx < w && ny >= 0 && ny < h {
                    buffer[(ny * w + nx) as usize] += error * weight;
                }
            }
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::Luma;

    const ALL: [DitherAlgorithm; 5] = [
        DitherAlgorithm::None,
        DitherAlgorithm::FloydSteinberg,
        DitherAlgorithm::Jarvis,
        DitherAlgorithm::Stucki,
        DitherAlgorithm::Atkinson,
    ];

    fn gradient(w: u32, h: u32) -> GrayImage {
        GrayImage::from_fn(w, h, |x, _| Luma([((x as f64 / w as f64) * 255.0) as u8]))
    }

    #[test]
    fn output_is_strictly_binary_for_every_algorithm() {
        for algo in ALL {
            let out = dither(&gradient(64, 16), algo, 128);
            assert!(
                out.pixels().all(|p| p.0[0] == 0 || p.0[0] == 255),
                "{algo:?}"
            );
        }
    }

    #[test]
    fn solid_black_and_white_are_preserved() {
        for algo in ALL {
            let black = dither(&GrayImage::from_pixel(8, 8, Luma([0])), algo, 128);
            let white = dither(&GrayImage::from_pixel(8, 8, Luma([255])), algo, 128);
            assert!(black.pixels().all(|p| p.0[0] == 0), "{algo:?}");
            assert!(white.pixels().all(|p| p.0[0] == 255), "{algo:?}");
        }
    }

    #[test]
    fn mid_grey_dithers_to_roughly_half_burn() {
        for algo in [
            DitherAlgorithm::FloydSteinberg,
            DitherAlgorithm::Jarvis,
            DitherAlgorithm::Stucki,
        ] {
            let out = dither(&GrayImage::from_pixel(64, 64, Luma([128])), algo, 128);
            let black = out.pixels().filter(|p| p.0[0] == 0).count() as f64;
            let fraction = black / (64.0 * 64.0);
            assert!(
                (0.35..=0.65).contains(&fraction),
                "{algo:?} burned {fraction}"
            );
        }
    }

    #[test]
    fn none_is_a_plain_threshold() {
        let out = dither(&gradient(10, 1), DitherAlgorithm::None, 128);
        for (x, p) in out.pixels().enumerate() {
            let original = ((x as f64 / 10.0) * 255.0) as u8;
            assert_eq!(p.0[0], if original >= 128 { 255 } else { 0 });
        }
    }

    #[test]
    fn dimensions_are_preserved() {
        assert_eq!(
            dither(&gradient(17, 5), DitherAlgorithm::Atkinson, 128).dimensions(),
            (17, 5)
        );
    }
}
