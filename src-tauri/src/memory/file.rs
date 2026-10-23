use regex::Regex;
use std::sync::OnceLock;

pub const SECTIONS: [Section; 4] = [
    Section::User,
    Section::Preferences,
    Section::Project,
    Section::Decisions,
];
pub const MEMORY_BUDGET: usize = 2500;
pub const MEMORY_MAX_NOTES: usize = 24;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Kind {
    Fact,
    Preference,
    Summary,
    Note,
}

impl Kind {
    pub fn as_str(self) -> &'static str {
        match self {
            Kind::Fact => "fact",
            Kind::Preference => "preference",
            Kind::Summary => "summary",
            Kind::Note => "note",
        }
    }

    pub fn parse(value: &str) -> Option<Self> {
        match value {
            "fact" => Some(Kind::Fact),
            "preference" => Some(Kind::Preference),
            "summary" => Some(Kind::Summary),
            "note" => Some(Kind::Note),
            _ => None,
        }
    }

    pub fn section(self) -> Section {
        match self {
            Kind::Fact => Section::User,
            Kind::Preference => Section::Preferences,
            Kind::Summary => Section::Decisions,
            Kind::Note => Section::Project,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Section {
    User,
    Preferences,
    Project,
    Decisions,
}

impl Section {
    pub fn name(self) -> &'static str {
        match self {
            Section::User => "User",
            Section::Preferences => "Preferences",
            Section::Project => "Project",
            Section::Decisions => "Decisions",
        }
    }

    pub fn index(self) -> usize {
        match self {
            Section::User => 0,
            Section::Preferences => 1,
            Section::Project => 2,
            Section::Decisions => 3,
        }
    }

    pub fn parse(value: &str) -> Option<Self> {
        match value {
            "User" => Some(Section::User),
            "Preferences" => Some(Section::Preferences),
            "Project" => Some(Section::Project),
            "Decisions" => Some(Section::Decisions),
            _ => None,
        }
    }

    pub fn default_kind(self) -> Kind {
        match self {
            Section::User => Kind::Fact,
            Section::Preferences => Kind::Preference,
            Section::Project => Kind::Note,
            Section::Decisions => Kind::Summary,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Entry {
    pub id: String,
    pub text: String,
    pub date: String,
    pub kind: Kind,
    pub raw_kind: Option<String>,
}

impl Entry {
    pub fn new(
        id: impl Into<String>,
        text: impl Into<String>,
        date: impl Into<String>,
        kind: Kind,
    ) -> Self {
        Self {
            id: id.into(),
            text: text.into(),
            date: date.into(),
            kind,
            raw_kind: None,
        }
    }

    pub fn kind_label(&self) -> String {
        self.raw_kind
            .clone()
            .unwrap_or_else(|| self.kind.as_str().to_string())
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Doc {
    sections: [Vec<Entry>; 4],
    pub unknown: String,
}

impl Default for Doc {
    fn default() -> Self {
        Self {
            sections: std::array::from_fn(|_| Vec::new()),
            unknown: String::new(),
        }
    }
}

impl Doc {
    pub fn entries(&self) -> impl Iterator<Item = &Entry> {
        self.sections.iter().flat_map(|section| section.iter())
    }

    pub fn section(&self, section: Section) -> &[Entry] {
        &self.sections[section.index()]
    }

    pub fn len(&self) -> usize {
        self.sections.iter().map(Vec::len).sum()
    }

    pub fn push(&mut self, section: Section, entry: Entry) {
        self.sections[section.index()].push(entry);
    }

    pub fn find(&self, id: &str) -> Option<(Section, usize)> {
        for section in SECTIONS {
            if let Some(index) = self.sections[section.index()]
                .iter()
                .position(|entry| entry.id == id)
            {
                return Some((section, index));
            }
        }
        None
    }

    pub fn entry(&self, id: &str) -> Option<&Entry> {
        self.find(id)
            .map(|(section, index)| &self.sections[section.index()][index])
    }

    pub fn update(&mut self, id: &str, text: Option<&str>, kind: Option<Kind>) -> bool {
        let Some((section, index)) = self.find(id) else {
            return false;
        };
        let entry = &mut self.sections[section.index()][index];
        if let Some(text) = text {
            entry.text = one_line(text);
        }
        if let Some(kind) = kind {
            entry.kind = kind;
            entry.raw_kind = None;
        }
        true
    }

    pub fn forget(&mut self, id: &str) -> bool {
        let Some((section, index)) = self.find(id) else {
            return false;
        };
        self.sections[section.index()].remove(index);
        true
    }
}

pub fn canonical_id(raw: &str) -> String {
    let lower = raw.trim().to_ascii_lowercase();
    let stripped: String = lower.chars().filter(|c| *c != '-').collect();
    if is_canonical_id(&stripped) {
        return stripped;
    }
    use sha2::{Digest, Sha256};
    let mut hasher = Sha256::new();
    hasher.update(raw.as_bytes());
    let digest = format!("{:x}", hasher.finalize());
    digest[..32].to_string()
}

pub fn is_canonical_id(id: &str) -> bool {
    id.len() == 32 && id.chars().all(|c| c.is_ascii_hexdigit())
}

pub fn one_line(text: &str) -> String {
    text.split_whitespace().collect::<Vec<_>>().join(" ")
}

pub fn escape(text: &str) -> String {
    one_line(text)
        .replace("<!--", "<\\!--")
        .replace("-->", "-\\->")
}

pub fn unescape(text: &str) -> String {
    text.replace("<\\!--", "<!--").replace("-\\->", "-->")
}

fn anchor_regex() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| {
        Regex::new(
            r"^-\s+(.*?)\s*<!--m:([0-9a-fA-F]{32})\s+(\d{4}-\d{2}-\d{2})(?:\s+k:([A-Za-z0-9_-]+))?-->$",
        )
        .expect("memory anchor regex")
    })
}

pub fn parse(markdown: &str) -> Doc {
    let without_bom = markdown.strip_prefix('\u{feff}').unwrap_or(markdown);
    let normalized = without_bom.replace("\r\n", "\n").replace('\r', "\n");
    let mut doc = Doc::default();
    let mut section: Option<Section> = None;
    let mut unknown: Vec<&str> = Vec::new();

    for raw in normalized.split('\n') {
        let trimmed = raw.trim();
        if let Some(name) = trimmed.strip_prefix("## ") {
            if let Some(found) = Section::parse(name.trim()) {
                section = Some(found);
                continue;
            }
        }
        if trimmed.eq_ignore_ascii_case("# MEMORY") {
            continue;
        }
        if let Some(current) = section {
            if let Some(caps) = anchor_regex().captures(trimmed) {
                let text = unescape(caps.get(1).map(|m| m.as_str()).unwrap_or("").trim());
                let id = caps
                    .get(2)
                    .map(|m| m.as_str().to_ascii_lowercase())
                    .unwrap_or_default();
                let date = caps
                    .get(3)
                    .map(|m| m.as_str().to_string())
                    .unwrap_or_default();
                let (kind, raw_kind) = match caps.get(4) {
                    None => (current.default_kind(), None),
                    Some(value) => {
                        let raw = value.as_str().to_string();
                        match Kind::parse(&raw) {
                            Some(kind) if kind == current.default_kind() => (kind, None),
                            Some(kind) => (kind, Some(raw)),
                            None => (current.default_kind(), Some(raw)),
                        }
                    }
                };
                doc.sections[current.index()].push(Entry {
                    id,
                    text,
                    date,
                    kind,
                    raw_kind,
                });
                continue;
            }
        }
        unknown.push(raw);
    }

    doc.unknown = unknown.join("\n").trim_matches('\n').to_string();
    doc
}

pub fn render(doc: &Doc) -> String {
    let mut out = String::from("# MEMORY\n");
    for section in SECTIONS {
        out.push('\n');
        out.push_str("## ");
        out.push_str(section.name());
        out.push('\n');
        for entry in doc.section(section) {
            out.push_str("- ");
            out.push_str(&escape(&entry.text));
            out.push_str(" <!--m:");
            out.push_str(&entry.id);
            out.push(' ');
            out.push_str(&entry.date);
            let suffix = match &entry.raw_kind {
                Some(raw) => Some(raw.clone()),
                None if entry.kind != section.default_kind() => {
                    Some(entry.kind.as_str().to_string())
                }
                None => None,
            };
            if let Some(kind) = suffix {
                out.push_str(" k:");
                out.push_str(&kind);
            }
            out.push_str("-->\n");
        }
    }
    let unknown = doc.unknown.trim_matches('\n');
    if !unknown.is_empty() {
        out.push('\n');
        out.push_str(unknown);
        out.push('\n');
    }
    out
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Sent {
    pub ids: Vec<String>,
    pub chars: usize,
    pub omitted: usize,
}

pub fn sent(entries: &[Entry]) -> Sent {
    let mut ids = Vec::new();
    let mut chars = 0;
    for entry in entries.iter().take(MEMORY_MAX_NOTES) {
        let line = format!("- ({}) {}", entry.kind_label(), one_line(&entry.text));
        let cost = line.chars().count() + 1;
        if chars + cost > MEMORY_BUDGET {
            break;
        }
        chars += cost;
        ids.push(entry.id.clone());
    }
    let omitted = entries.len() - ids.len();
    Sent {
        ids,
        chars,
        omitted,
    }
}

pub fn today() -> String {
    chrono::Utc::now().format("%Y-%m-%d").to_string()
}

pub fn date_of_millis(ms: i64) -> String {
    chrono::DateTime::from_timestamp_millis(ms)
        .unwrap_or_else(chrono::Utc::now)
        .format("%Y-%m-%d")
        .to_string()
}

pub fn millis_of_date(date: &str) -> i64 {
    chrono::NaiveDate::parse_from_str(date, "%Y-%m-%d")
        .ok()
        .and_then(|day| day.and_hms_opt(0, 0, 0))
        .map(|stamp| stamp.and_utc().timestamp_millis())
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample() -> Doc {
        let mut doc = Doc::default();
        doc.push(
            Section::User,
            Entry::new(
                "a".repeat(32),
                "Prefers concise answers and ASCII diagrams",
                "2026-10-22",
                Kind::Fact,
            ),
        );
        doc.push(
            Section::Decisions,
            Entry::new(
                "b".repeat(32),
                "Sandbox runs only sandbox_run in Docker",
                "2026-10-19",
                Kind::Summary,
            ),
        );
        let mut project = Entry::new(
            "c".repeat(32),
            "myagent: Tauri + Rust + React/Tailwind",
            "2026-10-18",
            Kind::Preference,
        );
        project.raw_kind = Some("preference".to_string());
        doc.push(Section::Project, project);
        doc
    }

    #[test]
    fn a_rendered_file_round_trips() {
        let first = render(&sample());
        let parsed = parse(&first);
        assert_eq!(parsed.len(), 3);
        assert_eq!(render(&parsed), first);
        assert_eq!(parsed, sample());
    }

    #[test]
    fn an_empty_doc_renders_the_four_headings_and_parses_back() {
        let text = render(&Doc::default());
        for section in SECTIONS {
            assert!(text.contains(&format!("## {}", section.name())));
        }
        let parsed = parse(&text);
        assert_eq!(parsed.len(), 0);
        assert_eq!(render(&parsed), text);
    }

    #[test]
    fn a_file_with_only_a_heading_is_empty() {
        let parsed = parse("# MEMORY\n\n## User\n");
        assert_eq!(parsed.len(), 0);
        assert!(parsed.unknown.is_empty());
    }

    #[test]
    fn crlf_bom_and_unknown_text_survive() {
        let input = "\u{feff}# MEMORY\r\n\r\n## User\r\n- Direct corrections <!--m:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa 2026-10-20-->\r\n\r\nA paragraph the user wrote.\r\n\r\n<!-- keep this comment -->\r\n";
        let parsed = parse(input);
        assert_eq!(parsed.len(), 1);
        assert_eq!(parsed.entries().next().unwrap().text, "Direct corrections");
        assert!(parsed.unknown.contains("A paragraph the user wrote."));
        assert!(parsed.unknown.contains("<!-- keep this comment -->"));
        let rendered = render(&parsed);
        assert!(!rendered.contains('\r'));
        assert!(rendered.contains("A paragraph the user wrote."));
        assert_eq!(parse(&rendered), parsed);
    }

    #[test]
    fn a_double_hash_inside_note_text_stays_text() {
        let mut doc = Doc::default();
        doc.push(
            Section::Decisions,
            Entry::new(
                "d".repeat(32),
                "## not a heading",
                "2026-10-20",
                Kind::Summary,
            ),
        );
        let text = render(&doc);
        let parsed = parse(&text);
        assert_eq!(parsed.len(), 1);
        assert_eq!(parsed.entries().next().unwrap().text, "## not a heading");
    }

    #[test]
    fn comment_markers_in_text_are_escaped_and_restored() {
        let mut doc = Doc::default();
        doc.push(
            Section::User,
            Entry::new(
                "e".repeat(32),
                "uses <!--m:fake date--> literally",
                "2026-10-20",
                Kind::Fact,
            ),
        );
        let text = render(&doc);
        assert!(text.contains("<\\!--m:fake date-\\->"));
        let parsed = parse(&text);
        assert_eq!(
            parsed.entries().next().unwrap().text,
            "uses <!--m:fake date--> literally"
        );
    }

    #[test]
    fn multiline_text_is_flattened_on_write_and_escaped() {
        let mut doc = Doc::default();
        doc.push(
            Section::User,
            Entry::new(
                "f".repeat(32),
                "first line\nsecond\tline",
                "2026-10-20",
                Kind::Fact,
            ),
        );
        let text = render(&doc);
        assert!(text.contains("- first line second line <!--m:"));
        assert_eq!(
            parse(&text).entries().next().unwrap().text,
            "first line second line"
        );
    }

    #[test]
    fn unknown_kind_keeps_its_raw_label() {
        let input = "# MEMORY\n\n## Decisions\n- Old note <!--m:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa 2026-10-20 k:legacy-->\n";
        let parsed = parse(input);
        let entry = parsed.entries().next().unwrap();
        assert_eq!(entry.kind, Kind::Summary);
        assert_eq!(entry.kind_label(), "legacy");
        assert!(render(&parsed).contains("k:legacy"));
    }

    #[test]
    fn duplicate_ids_are_both_kept_and_find_returns_the_first() {
        let input = "# MEMORY\n\n## User\n- one <!--m:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa 2026-10-20-->\n- two <!--m:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa 2026-10-21-->\n";
        let parsed = parse(input);
        assert_eq!(parsed.len(), 2);
        assert_eq!(parsed.entry(&"a".repeat(32)).unwrap().text, "one");
    }

    #[test]
    fn a_plain_bullet_without_an_anchor_is_unknown_text() {
        let input = "# MEMORY\n\n## User\n- handmade note\n";
        let parsed = parse(input);
        assert_eq!(parsed.len(), 0);
        assert!(parsed.unknown.contains("- handmade note"));
    }

    #[test]
    fn uuids_canonicalise_and_dashes_are_stripped() {
        let uuid = "7F2A9C1E-5B6D-4A3F-8C2E-1D0B9A8F7E6D";
        assert_eq!(canonical_id(uuid), "7f2a9c1e5b6d4a3f8c2e1d0b9a8f7e6d");
        assert!(is_canonical_id(&canonical_id(uuid)));
    }

    #[test]
    fn a_non_uuid_id_still_gets_a_stable_32_hex_id() {
        let first = canonical_id("legacy-note-1");
        assert_eq!(first, canonical_id("legacy-note-1"));
        assert!(is_canonical_id(&first));
    }

    #[test]
    fn the_sent_budget_drops_notes_and_counts_them() {
        let entries: Vec<Entry> = (0..30)
            .map(|i| {
                Entry::new(
                    format!("{i:032x}"),
                    "x".repeat(120),
                    "2026-10-20",
                    Kind::Fact,
                )
            })
            .collect();
        let sent = sent(&entries);
        assert!(sent.chars <= MEMORY_BUDGET);
        assert!(sent.ids.len() < entries.len());
        assert_eq!(sent.omitted, entries.len() - sent.ids.len());
    }

    #[test]
    fn dates_convert_both_ways() {
        let ms = millis_of_date("2026-10-22");
        assert_eq!(date_of_millis(ms), "2026-10-22");
    }
}
