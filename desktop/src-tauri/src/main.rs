// Pas de console noire derrière la fenêtre en version publiée.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    remy_bureau_lib::run()
}
