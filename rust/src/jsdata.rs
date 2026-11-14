//! A small, lenient reader for the JavaScript data files of the browser game (`../js/data/*.js`).
//!
//! The files are plain object and array literals (`FG.data.x = { ... }` or `FG.data.x.push(...[ ... ])`), with
//! comments, single quotes, unquoted keys and trailing commas. Functions (event stories) are skipped: they are
//! written out in Rust (`events.rs`). Simple number arithmetic (`6 * 60`) is evaluated.

use serde_json::{Map, Number, Value};

pub struct Parser<'a> {
    s: &'a [u8],
    i: usize,
}

impl<'a> Parser<'a> {
    pub fn new(s: &'a str) -> Self {
        Self { s: s.as_bytes(), i: 0 }
    }

    fn peek(&self) -> u8 {
        *self.s.get(self.i).unwrap_or(&0)
    }

    fn skip_ws(&mut self) {
        loop {
            while self.i < self.s.len() && (self.s[self.i] as char).is_ascii_whitespace() {
                self.i += 1;
            }
            if self.s[self.i..].starts_with(b"//") {
                while self.i < self.s.len() && self.s[self.i] != b'\n' {
                    self.i += 1;
                }
            } else if self.s[self.i..].starts_with(b"/*") {
                self.i += 2;
                while self.i + 1 < self.s.len() && !self.s[self.i..].starts_with(b"*/") {
                    self.i += 1;
                }
                self.i += 2;
            } else {
                break;
            }
        }
    }

    fn expect(&mut self, c: u8) -> Result<(), String> {
        self.skip_ws();
        if self.peek() == c {
            self.i += 1;
            Ok(())
        } else {
            Err(self.err(&format!("expected '{}'", c as char)))
        }
    }

    fn err(&self, what: &str) -> String {
        let line = self.s[..self.i.min(self.s.len())].iter().filter(|&&c| c == b'\n').count() + 1;
        format!("{what} at line {line}")
    }

    pub fn value(&mut self) -> Result<Value, String> {
        let first = self.term()?;
        // number arithmetic: a * b, a + b, a / b, a - b (left to right, * and / first)
        let mut acc = first;
        loop {
            self.skip_ws();
            let op = self.peek();
            if !matches!(op, b'*' | b'/' | b'+' | b'-') || !acc.is_number() {
                return Ok(acc);
            }
            self.i += 1;
            let rhs = self.term()?;
            let (a, b) = (acc.as_f64().unwrap_or(0.0), rhs.as_f64().unwrap_or(0.0));
            let v = match op {
                b'*' => a * b,
                b'/' => a / b,
                b'+' => a + b,
                _ => a - b,
            };
            acc = num(v);
        }
    }

    fn term(&mut self) -> Result<Value, String> {
        self.skip_ws();
        match self.peek() {
            b'{' => self.object(),
            b'[' => self.array(),
            b'\'' | b'"' | b'`' => Ok(Value::String(self.string()?)),
            b'(' => {
                // arrow function or parenthesised expression: skip it
                self.skip_balanced();
                self.skip_ws();
                if self.s[self.i..].starts_with(b"=>") {
                    self.i += 2;
                    self.skip_ws();
                    if self.peek() == b'{' || self.peek() == b'(' {
                        self.skip_balanced();
                    } else {
                        self.skip_expression();
                    }
                }
                Ok(Value::Null)
            }
            c if c == b'-' || c == b'.' || c.is_ascii_digit() => self.number(),
            _ => {
                let id = self.ident();
                match id.as_str() {
                    "true" => Ok(Value::Bool(true)),
                    "false" => Ok(Value::Bool(false)),
                    "null" | "undefined" => Ok(Value::Null),
                    "Infinity" => Ok(num(1e300)),
                    "function" => {
                        self.skip_ws();
                        self.ident();
                        self.skip_balanced(); // (args)
                        self.skip_ws();
                        self.skip_balanced(); // { body }
                        Ok(Value::Null)
                    }
                    "" => Err(self.err("unexpected character")),
                    _ => {
                        // some other expression (x => ..., Math.round(...)): skip to the next , } ]
                        self.skip_ws();
                        if self.s[self.i..].starts_with(b"=>") {
                            self.i += 2;
                            self.skip_ws();
                            if self.peek() == b'{' || self.peek() == b'(' {
                                self.skip_balanced();
                            } else {
                                self.skip_expression();
                            }
                        } else {
                            self.skip_expression();
                        }
                        Ok(Value::Null)
                    }
                }
            }
        }
    }

    /// Skips a bracketed block starting at the current ( [ or {, minding strings.
    fn skip_balanced(&mut self) {
        let mut depth = 0i32;
        while self.i < self.s.len() {
            let c = self.s[self.i];
            match c {
                b'\'' | b'"' | b'`' => {
                    let _ = self.string();
                    continue;
                }
                b'(' | b'[' | b'{' => depth += 1,
                b')' | b']' | b'}' => {
                    depth -= 1;
                    if depth <= 0 {
                        self.i += 1;
                        return;
                    }
                }
                _ => {}
            }
            self.i += 1;
        }
    }

    /// Skips an expression up to the next , } or ] at this depth.
    fn skip_expression(&mut self) {
        while self.i < self.s.len() {
            match self.s[self.i] {
                b',' | b'}' | b']' => return,
                b'\'' | b'"' | b'`' => {
                    let _ = self.string();
                }
                b'(' | b'[' | b'{' => self.skip_balanced(),
                _ => self.i += 1,
            }
        }
    }

    fn ident(&mut self) -> String {
        let start = self.i;
        while self.i < self.s.len() {
            let c = self.s[self.i];
            if c.is_ascii_alphanumeric() || c == b'_' || c == b'$' || c >= 0x80 {
                self.i += 1;
            } else {
                break;
            }
        }
        String::from_utf8_lossy(&self.s[start..self.i]).into_owned()
    }

    fn number(&mut self) -> Result<Value, String> {
        let start = self.i;
        if self.peek() == b'-' {
            self.i += 1;
        }
        while self.i < self.s.len() {
            let c = self.s[self.i];
            if c.is_ascii_digit() || c == b'.' || c == b'e' || c == b'E' || c == b'_' {
                self.i += 1;
            } else if (c == b'-' || c == b'+') && matches!(self.s[self.i - 1], b'e' | b'E') {
                self.i += 1;
            } else {
                break;
            }
        }
        let txt: String = String::from_utf8_lossy(&self.s[start..self.i]).replace('_', "");
        txt.parse::<f64>().map(num).map_err(|_| self.err("bad number"))
    }

    fn string(&mut self) -> Result<String, String> {
        let q = self.s[self.i];
        self.i += 1;
        let mut out: Vec<u8> = Vec::new();
        while self.i < self.s.len() {
            let c = self.s[self.i];
            if c == q {
                self.i += 1;
                return Ok(String::from_utf8_lossy(&out).into_owned());
            }
            if c == b'\\' && self.i + 1 < self.s.len() {
                self.i += 1;
                let e = self.s[self.i];
                match e {
                    b'n' => out.push(b'\n'),
                    b't' => out.push(b'\t'),
                    b'u' => {
                        let hex = String::from_utf8_lossy(&self.s[self.i + 1..self.i + 5]).into_owned();
                        if let Some(ch) = u32::from_str_radix(&hex, 16).ok().and_then(char::from_u32) {
                            let mut buf = [0u8; 4];
                            out.extend_from_slice(ch.encode_utf8(&mut buf).as_bytes());
                        }
                        self.i += 4;
                    }
                    _ => out.push(e),
                }
                self.i += 1;
                continue;
            }
            if q == b'`' && c == b'$' && self.s.get(self.i + 1) == Some(&b'{') {
                // template expression: keep it as text
                let start = self.i;
                self.i += 1;
                self.skip_balanced();
                out.extend_from_slice(&self.s[start..self.i]);
                continue;
            }
            out.push(c);
            self.i += 1;
        }
        Err(self.err("unterminated string"))
    }

    fn array(&mut self) -> Result<Value, String> {
        self.expect(b'[')?;
        let mut out = Vec::new();
        loop {
            self.skip_ws();
            if self.peek() == b']' {
                self.i += 1;
                return Ok(Value::Array(out));
            }
            if self.s[self.i..].starts_with(b"...") {
                self.i += 3;
            }
            out.push(self.value()?);
            self.skip_ws();
            match self.peek() {
                b',' => self.i += 1,
                b']' => {}
                _ => return Err(self.err("expected , or ] in array")),
            }
        }
    }

    fn object(&mut self) -> Result<Value, String> {
        self.expect(b'{')?;
        let mut out = Map::new();
        loop {
            self.skip_ws();
            match self.peek() {
                b'}' => {
                    self.i += 1;
                    return Ok(Value::Object(out));
                }
                b'\'' | b'"' | b'`' => {
                    let k = self.string()?;
                    self.member(k, &mut out)?;
                }
                b'[' => {
                    // computed key: skip the member
                    self.skip_balanced();
                    self.skip_ws();
                    if self.peek() == b':' {
                        self.i += 1;
                        self.value()?;
                    }
                }
                b'.' if self.s[self.i..].starts_with(b"...") => {
                    self.i += 3;
                    self.value()?;
                }
                _ => {
                    let k = self.ident();
                    if k.is_empty() {
                        return Err(self.err("bad object key"));
                    }
                    self.skip_ws();
                    if self.peek() == b'(' {
                        // method: name(args) { body }
                        self.skip_balanced();
                        self.skip_ws();
                        self.skip_balanced();
                    } else if self.peek() == b',' || self.peek() == b'}' {
                        out.insert(k, Value::Null); // shorthand property
                    } else {
                        self.member(k, &mut out)?;
                    }
                }
            }
            self.skip_ws();
            match self.peek() {
                b',' => self.i += 1,
                b'}' => {}
                _ => return Err(self.err("expected , or } in object")),
            }
        }
    }

    fn member(&mut self, k: String, out: &mut Map<String, Value>) -> Result<(), String> {
        self.expect(b':')?;
        let v = self.value()?;
        out.insert(k, v);
        Ok(())
    }
}

fn num(v: f64) -> Value {
    Number::from_f64(v).map(Value::Number).unwrap_or(Value::Null)
}

/// The literal assigned to `FG.data.<name> = ...` in `src`.
pub fn assigned(src: &str, name: &str) -> Result<Value, String> {
    let pat = format!("FG.data.{name} = ");
    let at = src.find(&pat).ok_or_else(|| format!("FG.data.{name} not found"))?;
    let mut p = Parser::new(&src[at + pat.len()..]);
    p.value().map_err(|e| format!("FG.data.{name}: {e}"))
}

/// The array literals pushed with `FG.data.<name>.push(...[ ... ])` in `src`, joined.
pub fn pushed(src: &str, name: &str) -> Result<Vec<Value>, String> {
    let pat = format!("FG.data.{name}.push(");
    let mut out = Vec::new();
    let mut from = 0;
    while let Some(at) = src[from..].find(&pat) {
        let start = from + at + pat.len();
        let mut p = Parser::new(&src[start..]);
        p.skip_ws();
        if p.s[p.i..].starts_with(b"...") {
            p.i += 3;
        }
        match p.value().map_err(|e| format!("FG.data.{name}.push: {e}"))? {
            Value::Array(a) => out.extend(a),
            v => out.push(v),
        }
        from = start + p.i;
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn literals() {
        let v = assigned(
            "// x\nFG.data.a = { b: 'x', 'c-d': [1, 2,], e: 6 * 60, f: (x) => x + 1, g() { return 1; }, h: true };",
            "a",
        )
        .unwrap();
        assert_eq!(v["b"], "x");
        assert_eq!(v["c-d"][1], 2.0);
        assert_eq!(v["e"], 360.0);
        assert_eq!(v["h"], true);
    }
}
