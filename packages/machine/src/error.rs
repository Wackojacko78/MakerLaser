use thiserror::Error;

#[derive(Debug, Error)]
pub enum MachineError {
    #[error("no machine or simulator is connected")]
    NotConnected,

    #[error("already connected: disconnect first")]
    AlreadyConnected,

    #[error("the machine on {0} did not answer. Check the port, baud rate and cable")]
    NoResponse(String),

    #[error("the machine connection was lost")]
    Disconnected,

    #[error("serial port error: {0}")]
    SerialPort(#[from] serialport::Error),

    #[error("I/O error talking to the machine: {0}")]
    Io(#[from] std::io::Error),

    #[error("GRBL rejected a command: {0}")]
    GrblError(String),

    #[error("GRBL alarm: {0}")]
    AlarmActive(String),

    #[error("job aborted")]
    Aborted,

    #[error("timed out waiting for the machine")]
    Timeout,

    #[error("the machine is not idle (state: {0}); resolve this before running a job")]
    NotIdle(String),

    #[error("invalid request: {0}")]
    InvalidRequest(String),

    #[error("internal state error: {0}")]
    InternalState(String),
}

pub type Result<T> = std::result::Result<T, MachineError>;
