//! The `.mlp` project format: a zip archive holding `project.json` plus one
//! `images/<asset-id>.<ext>` entry per image asset. Saving is atomic (write to a temporary
//! file, then rename), so a crash or full disk can never destroy an existing project.

use std::collections::{HashMap, HashSet};
use std::fs::{self, File};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};

use makerlaser_common::{ObjectKind, ProjectFile, PROJECT_SCHEMA_VERSION};
use uuid::Uuid;
use zip::write::SimpleFileOptions;
use zip::{ZipArchive, ZipWriter};

use crate::error::{ProjectError, Result};

fn entry_options() -> SimpleFileOptions {
    SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated)
}

fn temp_path_for(path: &Path) -> PathBuf {
    let mut name = path
        .file_name()
        .map(|n| n.to_os_string())
        .unwrap_or_default();
    name.push(".tmp");
    path.with_file_name(name)
}

/// Saves `project` and the image assets it references. `images` maps asset id to bytes;
/// assets no object references are not written.
pub fn save_project(
    path: &Path,
    project: &ProjectFile,
    images: &HashMap<Uuid, Vec<u8>>,
) -> Result<()> {
    let temp = temp_path_for(path);
    let outcome = write_archive(&temp, project, images).and_then(|()| {
        fs::rename(&temp, path)?;
        Ok(())
    });
    if outcome.is_err() {
        let _ = fs::remove_file(&temp);
    }
    outcome
}

fn write_archive(
    path: &Path,
    project: &ProjectFile,
    images: &HashMap<Uuid, Vec<u8>>,
) -> Result<()> {
    let mut zip = ZipWriter::new(File::create(path)?);

    zip.start_file("project.json", entry_options())?;
    zip.write_all(&serde_json::to_vec_pretty(project)?)?;

    let mut written: HashSet<Uuid> = HashSet::new();
    for obj in &project.objects {
        if let ObjectKind::Image(image) = &obj.kind {
            if written.insert(image.asset_id) {
                if let Some(bytes) = images.get(&image.asset_id) {
                    zip.start_file(
                        format!("images/{}.{}", image.asset_id, image.format.extension()),
                        entry_options(),
                    )?;
                    zip.write_all(bytes)?;
                }
            }
        }
    }

    let file = zip.finish()?;
    file.sync_all()?;
    Ok(())
}

/// Loads a project and its image assets.
pub fn load_project(path: &Path) -> Result<(ProjectFile, HashMap<Uuid, Vec<u8>>)> {
    let mut archive = ZipArchive::new(File::open(path)?)?;

    let project: ProjectFile = {
        let mut entry = archive.by_name("project.json").map_err(|_| {
            ProjectError::InvalidProjectFile("the archive has no project.json".to_string())
        })?;
        let mut text = String::new();
        entry.read_to_string(&mut text)?;
        serde_json::from_str(&text)?
    };
    if project.schema_version > PROJECT_SCHEMA_VERSION {
        return Err(ProjectError::NewerSchema {
            found: project.schema_version,
            supported: PROJECT_SCHEMA_VERSION,
        });
    }

    let mut images = HashMap::new();
    for i in 0..archive.len() {
        let mut entry = archive.by_index(i)?;
        let name = entry.name().to_string();
        let Some(rest) = name.strip_prefix("images/") else {
            continue;
        };
        let Some(stem) = rest.split('.').next() else {
            continue;
        };
        let Ok(id) = Uuid::parse_str(stem) else {
            continue;
        };
        let mut bytes = Vec::new();
        entry.read_to_end(&mut bytes)?;
        images.insert(id, bytes);
    }
    Ok((project, images))
}

#[cfg(test)]
mod tests {
    use super::*;
    use makerlaser_common::{ImageData, ImageFormat, MachineProfile, WorkspaceObject};

    fn temp_file(tag: &str) -> PathBuf {
        std::env::temp_dir().join(format!("makerlaser-{tag}-{}.mlp", Uuid::new_v4()))
    }

    fn project_with_image() -> (ProjectFile, Uuid) {
        let mut p = ProjectFile::new("Round trip", MachineProfile::tts55_pro());
        let asset = Uuid::new_v4();
        let image = ImageData {
            asset_id: asset,
            format: ImageFormat::Png,
            source_path: None,
            width_px: 2,
            height_px: 2,
            dpi: 96.0,
        };
        p.objects
            .push(WorkspaceObject::new_image("Photo", image.clone(), 0));
        // A duplicate object shares the same asset: it must be stored once.
        p.objects
            .push(WorkspaceObject::new_image("Photo copy", image, 1));
        (p, asset)
    }

    #[test]
    fn save_and_load_round_trip() {
        let (project, asset) = project_with_image();
        let mut images = HashMap::new();
        images.insert(asset, vec![1u8, 2, 3, 4]);
        images.insert(Uuid::new_v4(), vec![9u8]); // unreferenced: must not be written

        let path = temp_file("rt");
        save_project(&path, &project, &images).unwrap();
        let (loaded, loaded_images) = load_project(&path).unwrap();
        let _ = fs::remove_file(&path);

        assert_eq!(loaded, project);
        assert_eq!(loaded_images.len(), 1);
        assert_eq!(loaded_images.get(&asset), Some(&vec![1u8, 2, 3, 4]));
    }

    #[test]
    fn saving_leaves_no_temporary_file_behind() {
        let (project, _) = project_with_image();
        let path = temp_file("tmp");
        save_project(&path, &project, &HashMap::new()).unwrap();
        assert!(path.exists());
        assert!(!temp_path_for(&path).exists());
        let _ = fs::remove_file(&path);
    }

    #[test]
    fn a_failed_save_does_not_destroy_the_existing_file() {
        let (project, _) = project_with_image();
        let path = temp_file("keep");
        save_project(&path, &project, &HashMap::new()).unwrap();
        let before = fs::read(&path).unwrap();
        // Saving into a directory that does not exist fails...
        let bad = std::env::temp_dir()
            .join("no-such-dir-makerlaser")
            .join("x.mlp");
        assert!(save_project(&bad, &project, &HashMap::new()).is_err());
        // ...and the earlier file is untouched.
        assert_eq!(fs::read(&path).unwrap(), before);
        let _ = fs::remove_file(&path);
    }

    #[test]
    fn archives_without_project_json_are_rejected() {
        let path = temp_file("bad");
        {
            let mut zip = ZipWriter::new(File::create(&path).unwrap());
            zip.start_file("other.txt", entry_options()).unwrap();
            zip.write_all(b"hello").unwrap();
            zip.finish().unwrap();
        }
        assert!(matches!(
            load_project(&path),
            Err(ProjectError::InvalidProjectFile(_))
        ));
        let _ = fs::remove_file(&path);
    }

    #[test]
    fn projects_from_a_newer_version_are_refused_with_a_clear_error() {
        let mut project = ProjectFile::new("Future", MachineProfile::tts55_pro());
        project.schema_version = PROJECT_SCHEMA_VERSION + 1;
        let path = temp_file("future");
        save_project(&path, &project, &HashMap::new()).unwrap();
        assert!(matches!(
            load_project(&path),
            Err(ProjectError::NewerSchema { .. })
        ));
        let _ = fs::remove_file(&path);
    }

    #[test]
    fn non_zip_files_are_rejected() {
        let path = temp_file("junk");
        fs::write(&path, b"this is not a zip").unwrap();
        assert!(load_project(&path).is_err());
        let _ = fs::remove_file(&path);
    }
}
