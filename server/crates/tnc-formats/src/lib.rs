//! HEIDENHAIN file formats, without the interpreter.
//!
//! - program text: bytes from a control are UTF-8 or Windows-1252; continuation `~` and CRs are dropped
//! - program names: what the TNC file manager accepts (`A-Z 0-9 _`, 16 characters, `.H`)
//! - `TOOL.T` tool tables: fixed-width columns whose positions come from the header line
//!
//! These mirror `profile.js` / `ui.js` in the browser so files move between the two unchanged.

use std::sync::LazyLock;

use regex::Regex;
use serde::{Deserialize, Serialize};

/// Machines the simulator knows. A new machine is one entry here and one in `machines.js`.
pub const MACHINES: &[&str] = &["426", "430"];

pub fn is_machine(m: &str) -> bool {
    MACHINES.contains(&m)
}

/// Bytes to text: UTF-8 when valid, else Windows-1252 (files straight off a real control).
pub fn decode(bytes: &[u8]) -> String {
    let bytes = bytes.strip_prefix(b"\xEF\xBB\xBF").unwrap_or(bytes);
    match std::str::from_utf8(bytes) {
        Ok(s) => s.to_owned(),
        Err(_) => encoding_rs::WINDOWS_1252.decode_without_bom_handling(bytes).0.into_owned(),
    }
}

/// Text to Windows-1252 for a control's file transfer. `None` if a character has no 1252 code.
pub fn encode_cp1252(text: &str) -> Option<Vec<u8>> {
    let (out, _, bad) = encoding_rs::WINDOWS_1252.encode(text);
    (!bad).then(|| out.into_owned())
}

/// The program as stored: LF line ends, no trailing `~` continuation marks, trimmed (as `cleanPgm` in ui.js).
pub fn clean(text: &str) -> String {
    static TILDE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"\s*~\s*$").unwrap());
    text.replace('\r', "")
        .split('\n')
        .map(|l| TILDE.replace(l, "").into_owned())
        .collect::<Vec<_>>()
        .join("\n")
        .trim()
        .to_owned()
}

/// A file or program name as the TNC file manager takes it: `NAME.H`, `A-Z 0-9 _`, at most 16 before the dot.
/// Anything else is replaced by `_`; an empty name becomes `PGM.H`.
pub fn program_name(name: &str) -> String {
    let stem = name.trim();
    let stem = match stem.rfind('.') {
        Some(i) if i > 0 => &stem[..i],
        _ => stem,
    };
    let mut s: String = stem
        .to_uppercase()
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() || c == '_' { c } else { '_' })
        .take(16)
        .collect();
    if s.is_empty() {
        s = "PGM".into();
    }
    s + ".H"
}

/// `name` with `_2`, `_3`, … appended (stem cut to fit 16) until `taken` says it is free.
pub fn unique_name(name: &str, taken: impl Fn(&str) -> bool) -> String {
    let first = program_name(name);
    if !taken(&first) {
        return first;
    }
    let stem = first.trim_end_matches(".H").to_owned();
    for k in 2.. {
        let suffix = format!("_{k}");
        let cut: String = stem.chars().take(16 - suffix.len()).collect();
        let n = format!("{cut}{suffix}.H");
        if !taken(&n) {
            return n;
        }
    }
    unreachable!()
}

/// What `BEGIN PGM` says, read without running the program.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Header {
    pub name: String,
    pub unit: String,
}

pub fn header(text: &str) -> Option<Header> {
    static BEGIN: LazyLock<Regex> =
        LazyLock::new(|| Regex::new(r"(?mi)^\s*(?:\d+\s+)?BEGIN\s+PGM\s+(\S+)\s+(MM|INCH)\b").unwrap());
    BEGIN.captures(text).map(|c| Header { name: c[1].to_uppercase(), unit: c[2].to_uppercase() })
}

/// A program file's kind by name: `.H` Klartext, `.I` ISO, `.T` tool table.
pub fn is_program_file(name: &str) -> bool {
    let n = name.to_ascii_lowercase();
    n.ends_with(".h") || n.ends_with(".i")
}

/* ---------------- TOOL.T ---------------- */

/// One row of the tool table, as the simulator uses it (`profile.js`: `{t, name, l, r}`).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Tool {
    pub t: u32,
    pub name: String,
    pub l: f64,
    pub r: f64,
}

/// ```text
/// BEGIN TOOL .T MM
/// T    NAME             L          R          R2 ...
/// 0    NULLWERKZEUG     +0         +0 ...
/// [END]
/// ```
/// Columns are fixed-width; positions come from the header line. `None` when there is no `T NAME` header.
pub fn parse_tool_t(text: &str) -> Option<Vec<Tool>> {
    static HDR: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^\s*T\s+NAME\b").unwrap());
    static WORD: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"\S+").unwrap());
    let text = text.replace('\r', "");
    let lines: Vec<&str> = text.split('\n').collect();
    let hdr = lines.iter().position(|l| HDR.is_match(l))?;
    let cols: Vec<(String, usize)> = WORD.find_iter(lines[hdr]).map(|m| (m.as_str().to_owned(), m.start())).collect();
    let cell = |line: &str, key: &str| -> String {
        let Some(i) = cols.iter().position(|(k, _)| k == key) else { return String::new() };
        let start = cols[i].1;
        let end = cols.get(i + 1).map(|c| c.1).unwrap_or(usize::MAX);
        let chars: Vec<char> = line.chars().collect();
        if start >= chars.len() {
            return String::new();
        }
        chars[start..end.min(chars.len())].iter().collect::<String>().trim().to_owned()
    };
    let num = |s: String| s.parse::<f64>().ok().filter(|v| v.is_finite()).unwrap_or(0.0);
    let mut tools = Vec::new();
    for line in &lines[hdr + 1..] {
        if line.trim().is_empty() || line.trim_start().starts_with("[END]") {
            continue;
        }
        let Ok(t) = cell(line, "T").parse::<u32>() else { continue };
        let name = cell(line, "NAME");
        let name = if name.is_empty() { format!("T{t}") } else { name.to_uppercase().chars().take(16).collect() };
        tools.push(Tool { t, name, l: num(cell(line, "L")), r: num(cell(line, "R")) });
    }
    Some(tools)
}

/// The table as a `TOOL.T` file (CRLF), sorted by tool number.
pub fn write_tool_t(tools: &[Tool]) -> String {
    fn pad(s: &str, n: usize) -> String {
        let s: String = s.chars().take(n).collect();
        format!("{s:<n$}")
    }
    fn num(v: f64) -> String {
        format!("{}{:.3}", if v < 0.0 { '-' } else { '+' }, v.abs())
    }
    let mut sorted = tools.to_vec();
    sorted.sort_by_key(|t| t.t);
    let mut out = vec!["BEGIN TOOL .T MM".to_owned(), pad("T", 5) + &pad("NAME", 17) + &pad("L", 11) + &pad("R", 11)];
    for t in &sorted {
        out.push(pad(&t.t.to_string(), 5) + &pad(&t.name, 17) + &pad(&num(t.l), 11) + &pad(&num(t.r), 11));
    }
    out.push("[END]".into());
    out.join("\r\n") + "\r\n"
}

/// Rejects tables the simulator could not use: duplicate numbers, negative radius, unreadable names.
pub fn validate_tools(tools: &[Tool]) -> Result<(), String> {
    let mut seen = std::collections::HashSet::new();
    for t in tools {
        if !seen.insert(t.t) {
            return Err(format!("TOOL {} IS IN THE TABLE TWICE", t.t));
        }
        if !(t.r.is_finite() && t.l.is_finite()) || t.r < 0.0 {
            return Err(format!("TOOL {}: L AND R MUST BE NUMBERS, R NOT NEGATIVE", t.t));
        }
        if t.name.is_empty() || t.name.chars().count() > 16 {
            return Err(format!("TOOL {}: NAME MUST BE 1-16 CHARACTERS", t.t));
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decodes_cp1252_when_not_utf8() {
        assert_eq!(decode(b"; M\xFCller"), "; Müller");
        assert_eq!(decode("; Müller".as_bytes()), "; Müller");
        assert_eq!(decode(b"\xEF\xBB\xBFBEGIN"), "BEGIN");
        assert_eq!(encode_cp1252("Müller").unwrap(), b"M\xFCller");
        assert!(encode_cp1252("中").is_none());
    }

    #[test]
    fn cleans_like_ui_js() {
        assert_eq!(clean("  0 BEGIN PGM A MM\r\n  4 CYCL DEF 200 ~\r\n  Q200=2 ~\r\n\r\n"), "0 BEGIN PGM A MM\n  4 CYCL DEF 200\n  Q200=2");
    }

    #[test]
    fn names() {
        assert_eq!(program_name("nameplate.h"), "NAMEPLATE.H");
        assert_eq!(program_name("my part-2.H"), "MY_PART_2.H");
        assert_eq!(program_name("ABCDEFGHIJKLMNOPQRS.H"), "ABCDEFGHIJKLMNOP.H");
        assert_eq!(program_name(""), "PGM.H");
        assert_eq!(program_name(".H"), "_H.H");
        let taken = ["A.H", "A_2.H"];
        assert_eq!(unique_name("a", |n| taken.contains(&n)), "A_3.H");
        assert_eq!(unique_name("ABCDEFGHIJKLMNOP", |n| n == "ABCDEFGHIJKLMNOP.H"), "ABCDEFGHIJKLMN_2.H");
    }

    #[test]
    fn reads_header() {
        let h = header("0 BEGIN PGM Plate MM\n1 END PGM Plate MM").unwrap();
        assert_eq!(h, Header { name: "PLATE".into(), unit: "MM".into() });
        assert!(header("L X+0").is_none());
    }

    #[test]
    fn tool_t_round_trip() {
        let src = "BEGIN TOOL .T MM\r\nT    NAME             L          R          R2\r\n0    NULLWERKZEUG     +0         +0         +0\r\n5    endmill_12       +88.750    +6.000     +0\r\n\r\n[END]\r\n";
        let tools = parse_tool_t(src).unwrap();
        assert_eq!(tools.len(), 2);
        assert_eq!(tools[1], Tool { t: 5, name: "ENDMILL_12".into(), l: 88.75, r: 6.0 });
        let again = parse_tool_t(&write_tool_t(&tools)).unwrap();
        assert_eq!(again, tools);
        assert!(parse_tool_t("no header").is_none());
    }

    #[test]
    fn validates_tools() {
        let t = |t, r| Tool { t, name: "X".into(), l: 0.0, r };
        assert!(validate_tools(&[t(1, 3.0), t(2, 0.0)]).is_ok());
        assert!(validate_tools(&[t(1, 3.0), t(1, 2.0)]).is_err());
        assert!(validate_tools(&[t(1, -1.0)]).is_err());
    }
}
