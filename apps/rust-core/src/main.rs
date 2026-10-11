//! MakerLaser desktop entry point. This is the "application services" layer: it holds state
//! and orchestrates the domain, CAM and machine crates for the React UI, but contains no
//! CAM, geometry or G-code logic of its own.

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod commands;
mod console;
mod placement;
mod state;

use commands::{
    config_cmds, gcode_cmds, geometry_cmds, import_cmds, machine_cmds, material_cmds, project_cmds,
};

fn main() {
    env_logger::init();

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(state::AppState::default())
        .invoke_handler(tauri::generate_handler![
            project_cmds::new_project,
            project_cmds::machine_presets,
            project_cmds::sync_project,
            project_cmds::save_project_as,
            project_cmds::save_project,
            project_cmds::open_project,
            project_cmds::project_file_path,
            project_cmds::get_image_data_url,
            project_cmds::raster_preview,
            import_cmds::import_artwork,
            gcode_cmds::generate_gcode,
            gcode_cmds::save_gcode,
            machine_cmds::list_serial_ports,
            machine_cmds::machine_connect,
            machine_cmds::machine_disconnect,
            machine_cmds::machine_status,
            machine_cmds::machine_jog,
            machine_cmds::machine_home,
            machine_cmds::machine_unlock,
            machine_cmds::machine_set_origin,
            machine_cmds::machine_set_user_origin,
            machine_cmds::machine_user_origin,
            machine_cmds::machine_clear_user_origin,
            machine_cmds::machine_frame,
            machine_cmds::machine_start,
            machine_cmds::machine_pause,
            machine_cmds::machine_resume,
            machine_cmds::machine_stop,
            machine_cmds::machine_send,
            material_cmds::import_materials,
            material_cmds::export_materials,
            config_cmds::read_config_file,
            config_cmds::write_config_file,
            geometry_cmds::boolean_paths,
            geometry_cmds::offset_paths,
        ])
        .run(tauri::generate_context!())
        .expect("error while running MakerLaser");
}
