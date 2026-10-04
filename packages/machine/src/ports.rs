//! Serial port discovery for the connection dropdown.

use serde::{Deserialize, Serialize};

use crate::error::Result;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct AvailablePort {
    pub name: String,
    pub description: Option<String>,
}

pub fn list_available_ports() -> Result<Vec<AvailablePort>> {
    let ports = serialport::available_ports()?;
    Ok(ports
        .into_iter()
        .map(|p| {
            let description = match p.port_type {
                serialport::SerialPortType::UsbPort(info) => {
                    let text = format!(
                        "{} {}",
                        info.manufacturer.unwrap_or_default(),
                        info.product.unwrap_or_default()
                    );
                    let text = text.trim().to_string();
                    if text.is_empty() {
                        None
                    } else {
                        Some(text)
                    }
                }
                _ => None,
            };
            AvailablePort {
                name: p.port_name,
                description,
            }
        })
        .collect())
}
