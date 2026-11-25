//! The game without its window: the world's data (read from the browser game's `js/data`) and the simulation.
#![recursion_limit = "256"]
pub mod config;
pub mod data;
pub mod events;
pub mod game;
pub mod savefmt;
pub mod jsdata;
pub mod weather;
pub mod layouts;
pub mod fixes;
pub mod track;
pub mod dev;
