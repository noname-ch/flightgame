//! The browser game's aircraft pictures: a side view of each type in the hangar (`models/hangar/<type>.webp`, for the
//! plane cards, the marketplace and the start screen) and a top view for the map (`models/icons/<type>.webp`), as
//! textures, decoded the first time they are needed.

use eframe::egui::{self, ColorImage, TextureHandle, TextureOptions};
use std::collections::HashMap;

include!(concat!(env!("OUT_DIR"), "/pictures.rs"));

/// The file name of a type's pictures, as the browser game's `FG.data.typeSlug`: "A220-300" → "a220-300".
pub fn slug(kind: &str) -> String {
    let mut out = String::new();
    let mut dash = false;
    for c in kind.to_lowercase().chars() {
        if c.is_ascii_alphanumeric() {
            out.push(c);
            dash = false;
        } else if !dash {
            out.push('-');
            dash = true;
        }
    }
    out
}

#[derive(Default)]
pub struct Pictures {
    hangar: HashMap<String, Option<TextureHandle>>,
    icons: HashMap<String, Option<TextureHandle>>,
}

fn decode(ctx: &egui::Context, name: &str, bytes: &[u8]) -> Option<TextureHandle> {
    let img = image::load_from_memory_with_format(bytes, image::ImageFormat::WebP).ok()?.to_rgba8();
    let size = [img.width() as usize, img.height() as usize];
    let color = ColorImage::from_rgba_unmultiplied(size, img.as_raw());
    Some(ctx.load_texture(name, color, TextureOptions::LINEAR))
}

fn find<'a>(table: &'a [(&str, &[u8])], kind: &str) -> Option<&'a [u8]> {
    let s = slug(kind);
    table.iter().find(|(k, _)| *k == s).map(|(_, b)| *b)
}

impl Pictures {
    /// The type standing in the hangar (1320 × 600, the plane in the middle, transparent around it).
    pub fn hangar(&mut self, ctx: &egui::Context, kind: &str) -> Option<TextureHandle> {
        self.hangar
            .entry(kind.to_string())
            .or_insert_with(|| find(HANGAR, kind).and_then(|b| decode(ctx, &format!("hangar-{kind}"), b)))
            .clone()
    }

    /// The type seen from above, nose up (128 × 128), for the map.
    pub fn icon(&mut self, ctx: &egui::Context, kind: &str) -> Option<TextureHandle> {
        self.icons
            .entry(kind.to_string())
            .or_insert_with(|| find(ICONS, kind).and_then(|b| decode(ctx, &format!("icon-{kind}"), b)))
            .clone()
    }
}

#[cfg(test)]
mod tests {
    #[test]
    fn every_type_has_pictures() {
        assert_eq!(super::slug("A220-300"), "a220-300");
        assert_eq!(super::slug("B737-800"), "b737-800");
        for a in &flightgame::data::data().aircraft {
            assert!(super::find(super::HANGAR, &a.code).is_some(), "no hangar picture for {}", a.code);
            assert!(super::find(super::ICONS, &a.code).is_some(), "no icon for {}", a.code);
        }
        let b = super::find(super::ICONS, "A320").unwrap();
        assert!(image::load_from_memory_with_format(b, image::ImageFormat::WebP).is_ok());
    }
}
