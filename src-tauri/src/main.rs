// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    if std::env::args().any(|arg| arg == "--computer-use") {
        myagent_lib::run_computer_use_server();
        return;
    }
    myagent_lib::run()
}
