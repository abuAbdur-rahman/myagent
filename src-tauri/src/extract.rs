use std::panic::{UnwindSafe, catch_unwind};

use calamine::{Data, Range, Reader as _};
use serde::Serialize;

const MAX_TEXT_BYTES: usize = 2 * 1024 * 1024;
const MAX_SHEETS: usize = 20;
const MAX_SHEET_ROWS: usize = 5000;
const MAX_SHEET_COLS: usize = 64;

#[derive(Debug, Serialize)]
pub struct ExtractFailure {
    pub code: String,
    pub message: String,
}

#[derive(Debug)]
pub enum ExtractError {
    Unsupported(String),
    NoTextLayer,
    Empty,
    Failed(String),
    Crashed,
}

type ExtractResult<T> = Result<T, ExtractError>;

impl ExtractFailure {
    pub fn new(code: &str, message: impl Into<String>) -> Self {
        ExtractFailure {
            code: code.to_string(),
            message: message.into(),
        }
    }
}

impl ExtractError {
    fn failure(self) -> ExtractFailure {
        match self {
            ExtractError::Unsupported(message) => ExtractFailure {
                code: "unsupported".to_string(),
                message,
            },
            ExtractError::NoTextLayer => ExtractFailure {
                code: "no_text_layer".to_string(),
                message: "no text layer in this pdf; a scanned document needs OCR, which is not supported"
                    .to_string(),
            },
            ExtractError::Empty => ExtractFailure {
                code: "empty".to_string(),
                message: "no readable text found".to_string(),
            },
            ExtractError::Failed(message) => ExtractFailure {
                code: "failed".to_string(),
                message,
            },
            ExtractError::Crashed => ExtractFailure {
                code: "crashed".to_string(),
                message: "this document could not be read safely".to_string(),
            },
        }
    }
}

#[derive(Clone, Copy)]
enum SheetKind {
    Xlsx,
    Xls,
    Ods,
}

enum Kind {
    Text,
    Html,
    Pdf,
    Docx,
    Spreadsheet(SheetKind),
}

const MEDIA_EXTENSIONS: &[&str] = &[
    "mp4", "m4v", "mov", "avi", "mkv", "webm", "wmv", "flv", "mpg", "mpeg", "3gp", "mp3", "wav",
    "ogg", "oga", "flac", "m4a", "aac", "wma", "opus", "mid", "midi", "gif", "png", "jpg", "jpeg",
    "webp", "bmp", "tif", "tiff", "heic", "avif", "ico", "svg",
];

const LEGACY_EXTENSIONS: &[&str] = &[
    "doc", "ppt", "pptx", "odt", "odp", "epub", "msg", "rtf", "pages", "numbers", "key",
];

const TEXT_EXTENSIONS: &[&str] = &[
    "md",
    "markdown",
    "mdx",
    "txt",
    "text",
    "csv",
    "tsv",
    "json",
    "jsonl",
    "yaml",
    "yml",
    "xml",
    "toml",
    "ini",
    "cfg",
    "conf",
    "env",
    "sql",
    "log",
    "diff",
    "patch",
    "rs",
    "ts",
    "tsx",
    "js",
    "jsx",
    "mjs",
    "cjs",
    "py",
    "rb",
    "go",
    "java",
    "kt",
    "kts",
    "swift",
    "c",
    "h",
    "cc",
    "cpp",
    "hpp",
    "cs",
    "php",
    "sh",
    "bash",
    "zsh",
    "ps1",
    "bat",
    "cmd",
    "css",
    "scss",
    "sass",
    "less",
    "vue",
    "svelte",
    "astro",
    "lua",
    "pl",
    "r",
    "dart",
    "ex",
    "exs",
    "erl",
    "hs",
    "clj",
    "scala",
    "tf",
    "hcl",
    "graphql",
    "gql",
    "proto",
    "lock",
    "gitignore",
    "editorconfig",
];

const HTML_EXTENSIONS: &[&str] = &["html", "htm", "xhtml"];

pub fn extract(name: &str, mime: &str, bytes: &[u8]) -> ExtractResult<String> {
    if bytes.is_empty() {
        return Err(ExtractError::Empty);
    }

    let text = match classify(name, mime)? {
        Kind::Text => decode_utf8(bytes)?,
        Kind::Html => html_body(bytes)?,
        Kind::Pdf => pdf_body(bytes)?,
        Kind::Docx => docx_body(bytes)?,
        Kind::Spreadsheet(kind) => spreadsheet_body(kind, bytes)?,
    };
    let text = normalize(&text);

    if text.trim().is_empty() {
        return Err(ExtractError::Empty);
    }
    Ok(cap(text))
}

pub fn extract_guarded(name: &str, mime: &str, bytes: &[u8]) -> Result<String, ExtractFailure> {
    guarded(|| extract(name, mime, bytes))
}

fn guarded<F>(run: F) -> Result<String, ExtractFailure>
where
    F: FnOnce() -> ExtractResult<String> + UnwindSafe,
{
    match catch_unwind(run) {
        Ok(Ok(text)) => Ok(text),
        Ok(Err(error)) => Err(error.failure()),
        Err(_) => Err(ExtractError::Crashed.failure()),
    }
}

pub fn extension(name: &str) -> String {
    name.rsplit_once('.')
        .map(|(_, ext)| ext.trim().to_ascii_lowercase())
        .unwrap_or_default()
}

fn base_mime(mime: &str) -> String {
    mime.split(';')
        .next()
        .unwrap_or("")
        .trim()
        .to_ascii_lowercase()
}

fn classify(name: &str, mime: &str) -> ExtractResult<Kind> {
    let base = base_mime(mime);
    let ext = extension(name);

    match base.as_str() {
        "application/pdf" | "application/x-pdf" => return Ok(Kind::Pdf),
        "text/html" | "application/xhtml+xml" => return Ok(Kind::Html),
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document" => {
            return Ok(Kind::Docx);
        }
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" => {
            return Ok(Kind::Spreadsheet(SheetKind::Xlsx));
        }
        "application/vnd.ms-excel" => return Ok(Kind::Spreadsheet(SheetKind::Xls)),
        "application/vnd.oasis.opendocument.spreadsheet" => {
            return Ok(Kind::Spreadsheet(SheetKind::Ods));
        }
        _ => {}
    }

    if base.starts_with("video/")
        || base.starts_with("audio/")
        || base.starts_with("image/")
        || MEDIA_EXTENSIONS.contains(&ext.as_str())
    {
        return Err(ExtractError::Unsupported(
            "media files are not supported here; images go through the image button".to_string(),
        ));
    }

    if base.starts_with("text/")
        || base == "application/json"
        || base == "application/xml"
        || base == "application/javascript"
        || base == "application/typescript"
        || base == "application/x-yaml"
    {
        return Ok(Kind::Text);
    }

    if HTML_EXTENSIONS.contains(&ext.as_str()) {
        return Ok(Kind::Html);
    }
    if ext == "pdf" {
        return Ok(Kind::Pdf);
    }
    if ext == "docx" {
        return Ok(Kind::Docx);
    }
    if ext == "xlsx" {
        return Ok(Kind::Spreadsheet(SheetKind::Xlsx));
    }
    if ext == "xls" {
        return Ok(Kind::Spreadsheet(SheetKind::Xls));
    }
    if ext == "ods" {
        return Ok(Kind::Spreadsheet(SheetKind::Ods));
    }
    if TEXT_EXTENSIONS.contains(&ext.as_str()) {
        return Ok(Kind::Text);
    }
    if LEGACY_EXTENSIONS.contains(&ext.as_str()) {
        return Err(ExtractError::Unsupported(
            "this format is not supported; save it as .docx, .xlsx or .pdf and attach that"
                .to_string(),
        ));
    }
    Err(ExtractError::Unsupported(
        "file type not supported; attach text, markdown, code, csv, json, html, pdf, docx or a spreadsheet"
            .to_string(),
    ))
}

fn decode_utf8(bytes: &[u8]) -> ExtractResult<String> {
    let body = bytes.strip_prefix(&[0xEF, 0xBB, 0xBF]).unwrap_or(bytes);
    let text = std::str::from_utf8(body)
        .map_err(|_| ExtractError::Unsupported("this file is not UTF-8 text".to_string()))?;
    if text.contains('\0') {
        return Err(ExtractError::Unsupported(
            "this file is not UTF-8 text".to_string(),
        ));
    }
    Ok(text.to_string())
}

fn html_body(bytes: &[u8]) -> ExtractResult<String> {
    let source = decode_utf8(bytes)?;
    htmd::convert(&source)
        .map_err(|error| ExtractError::Failed(format!("html could not be converted: {error}")))
}

fn pdf_body(bytes: &[u8]) -> ExtractResult<String> {
    let text = pdf_extract::extract_text_from_mem(bytes)
        .map_err(|error| ExtractError::Failed(format!("pdf could not be read: {error}")))?;
    if text.trim().is_empty() {
        return Err(ExtractError::NoTextLayer);
    }
    Ok(text)
}

fn docx_body(bytes: &[u8]) -> ExtractResult<String> {
    let docx = docx_rs::read_docx(bytes)
        .map_err(|error| ExtractError::Failed(format!("docx could not be read: {error}")))?;
    let mut out = String::new();
    render_children(&docx.document.children, &mut out);
    Ok(out)
}

fn render_children(children: &[docx_rs::DocumentChild], out: &mut String) {
    for child in children {
        match child {
            docx_rs::DocumentChild::Paragraph(paragraph) => {
                out.push_str(&paragraph_text(paragraph));
                out.push('\n');
            }
            docx_rs::DocumentChild::Table(table) => {
                for row in &table.rows {
                    let docx_rs::TableChild::TableRow(row) = row;
                    let cells: Vec<String> = row
                        .cells
                        .iter()
                        .map(|cell| {
                            let docx_rs::TableRowChild::TableCell(cell) = cell;
                            cell.children
                                .iter()
                                .map(|content| match content {
                                    docx_rs::TableCellContent::Paragraph(paragraph) => {
                                        paragraph_text(paragraph)
                                    }
                                    _ => String::new(),
                                })
                                .collect::<Vec<_>>()
                                .join(" ")
                                .trim()
                                .to_string()
                        })
                        .collect();
                    out.push_str(&cells.join(" | "));
                    out.push('\n');
                }
                out.push('\n');
            }
            _ => {}
        }
    }
}

fn paragraph_text(paragraph: &docx_rs::Paragraph) -> String {
    let mut line = String::new();
    for child in &paragraph.children {
        if let docx_rs::ParagraphChild::Run(run) = child {
            for item in &run.children {
                match item {
                    docx_rs::RunChild::Text(text) => line.push_str(&text.text),
                    docx_rs::RunChild::Break(_) => line.push('\n'),
                    _ => {}
                }
            }
        }
    }
    line
}

fn spreadsheet_body(kind: SheetKind, bytes: &[u8]) -> ExtractResult<String> {
    let cursor = std::io::Cursor::new(bytes);
    match kind {
        SheetKind::Xlsx => read_sheets(calamine::Xlsx::new(cursor)),
        SheetKind::Xls => read_sheets(calamine::Xls::new(cursor)),
        SheetKind::Ods => read_sheets(calamine::Ods::new(cursor)),
    }
}

fn read_sheets<R, W, E>(workbook: Result<W, E>) -> ExtractResult<String>
where
    R: std::io::Read + std::io::Seek,
    W: calamine::Reader<R>,
    E: std::fmt::Display,
{
    let mut workbook = workbook
        .map_err(|error| ExtractError::Failed(format!("spreadsheet could not be read: {error}")))?;
    let names = workbook.sheet_names().to_owned();
    if names.is_empty() {
        return Err(ExtractError::Empty);
    }
    let mut out = String::new();
    for (index, name) in names.iter().enumerate() {
        if index >= MAX_SHEETS {
            out.push_str(&format!(
                "\n[{} more sheets omitted]\n",
                names.len() - index
            ));
            break;
        }
        let Ok(range) = workbook.worksheet_range(name) else {
            continue;
        };
        render_sheet(name, &range, &mut out);
    }
    Ok(out)
}

fn render_sheet(name: &str, range: &Range<Data>, out: &mut String) {
    out.push_str(&format!("## {name}\n"));
    let truncated_rows = range.rows().count() > MAX_SHEET_ROWS;
    for (index, row) in range.rows().take(MAX_SHEET_ROWS).enumerate() {
        render_row(row, index == 0, out);
    }
    if truncated_rows {
        out.push_str("[more rows omitted]\n");
    }
    out.push('\n');
}

fn render_row(row: &[Data], header: bool, out: &mut String) {
    if header && row.iter().all(|cell| matches!(cell, Data::Empty)) {
        return;
    }
    let mut cells: Vec<String> = row.iter().take(MAX_SHEET_COLS).map(sheet_cell).collect();
    if row.len() > MAX_SHEET_COLS {
        cells.push("[more columns omitted]".to_string());
    }
    out.push_str(cells.join(", ").trim_end());
    out.push('\n');
}

fn sheet_cell(cell: &Data) -> String {
    let value = match cell {
        Data::Empty => String::new(),
        Data::String(text) => text.clone(),
        Data::Float(number) => number.to_string(),
        Data::Int(number) => number.to_string(),
        Data::Bool(flag) => flag.to_string(),
        Data::DateTime(stamp) => stamp
            .as_datetime()
            .map(|value| value.to_string())
            .unwrap_or_else(|| stamp.as_f64().to_string()),
        Data::DateTimeIso(text) => text.clone(),
        Data::DurationIso(text) => text.clone(),
        Data::Error(error) => format!("{error:?}"),
    };
    value.replace(['\n', '\r'], " ")
}

fn normalize(text: &str) -> String {
    text.replace("\r\n", "\n").replace('\r', "\n")
}

fn cap(text: String) -> String {
    if text.len() <= MAX_TEXT_BYTES {
        return text;
    }
    let marker = format!("\n[document truncated at {MAX_TEXT_BYTES} bytes]\n");
    let mut end = MAX_TEXT_BYTES - marker.len();
    while end > 0 && !text.is_char_boundary(end) {
        end -= 1;
    }
    format!("{}{}", &text[..end], marker)
}

#[cfg(test)]
mod tests {
    use super::*;
    use calamine::Cell;

    fn code(result: Result<String, ExtractFailure>) -> String {
        match result {
            Ok(_) => "ok".to_string(),
            Err(failure) => failure.code,
        }
    }

    #[test]
    fn reads_utf8_text_and_normalises_newlines() {
        let bytes = b"\xEF\xBB\xBFfirst\r\nsecond\rthird";
        let text = extract("notes.md", "text/markdown", bytes).unwrap();
        assert_eq!(text, "first\nsecond\nthird");
    }

    #[test]
    fn reads_text_by_extension_when_mime_is_unknown() {
        let text = extract("data.json", "application/octet-stream", b"{\"a\":1}").unwrap();
        assert_eq!(text, "{\"a\":1}");
    }

    #[test]
    fn refuses_non_utf8_text() {
        let failure = extract("notes.txt", "text/plain", &[0xC3, 0x28]).unwrap_err();
        assert!(matches!(failure, ExtractError::Unsupported(_)));
    }

    #[test]
    fn refuses_binary_dressed_as_text() {
        assert_eq!(
            code(extract_guarded("notes.txt", "text/plain", b"a\0b")),
            "unsupported"
        );
    }

    #[test]
    fn refuses_media_with_a_pointer_to_the_image_path() {
        let failure = extract("clip.mp4", "video/mp4", b"....").unwrap_err();
        match failure {
            ExtractError::Unsupported(message) => assert!(message.contains("image button")),
            other => panic!("expected unsupported, got {other:?}"),
        }
    }

    #[test]
    fn refuses_legacy_office_with_a_conversion_hint() {
        let failure = extract("report.doc", "application/msword", b"....").unwrap_err();
        match failure {
            ExtractError::Unsupported(message) => assert!(message.contains(".docx")),
            other => panic!("expected unsupported, got {other:?}"),
        }
    }

    #[test]
    fn refuses_unknown_types() {
        assert_eq!(
            code(extract_guarded("blob.bin", "", b"....")),
            "unsupported"
        );
    }

    #[test]
    fn converts_html_to_markdown() {
        let text = extract(
            "page.html",
            "text/html",
            b"<html><body><h1>Title</h1><p>Body text</p></body></html>",
        )
        .unwrap();
        assert!(text.contains("Title"), "{text}");
        assert!(text.contains("Body text"), "{text}");
    }

    #[test]
    fn reads_a_docx_written_by_the_same_library() {
        use docx_rs::{Docx, Paragraph, Run};

        let docx = Docx::new()
            .add_paragraph(Paragraph::new().add_run(Run::new().add_text("Quarterly report")))
            .add_paragraph(Paragraph::new().add_run(Run::new().add_text("Revenue up")));
        let mut buffer = std::io::Cursor::new(Vec::new());
        docx.build().pack(&mut buffer).unwrap();
        let bytes = buffer.into_inner();

        let text = extract(
            "report.docx",
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            &bytes,
        )
        .unwrap();
        assert!(text.contains("Quarterly report"), "{text}");
        assert!(text.contains("Revenue up"), "{text}");
    }

    fn tiny_pdf(stream: &str) -> Vec<u8> {
        let objects = [
            "<< /Type /Catalog /Pages 2 0 R >>".to_string(),
            "<< /Type /Pages /Kids [3 0 R] /Count 1 >>".to_string(),
            "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>".to_string(),
            format!("<< /Length {} >>\nstream\n{stream}\nendstream", stream.len()),
            "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>".to_string(),
        ];
        let mut body = String::from("%PDF-1.4\n");
        let mut offsets = Vec::new();
        for (index, object) in objects.iter().enumerate() {
            offsets.push(body.len());
            body.push_str(&format!("{} 0 obj\n{object}\nendobj\n", index + 1));
        }
        let xref = body.len();
        body.push_str(&format!("xref\n0 {}\n", objects.len() + 1));
        body.push_str("0000000000 65535 f \n");
        for offset in offsets {
            body.push_str(&format!("{offset:010} 00000 n \n"));
        }
        body.push_str(&format!(
            "trailer\n<< /Size {} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n",
            objects.len() + 1
        ));
        body.into_bytes()
    }

    #[test]
    fn reads_a_pdf_text_layer() {
        let pdf = tiny_pdf("BT /F1 24 Tf 20 100 Td (Hello PDF) Tj ET");
        let text = extract("doc.pdf", "application/pdf", &pdf).unwrap();
        assert!(text.contains("Hello PDF"), "{text}");
    }

    #[test]
    fn refuses_a_pdf_without_a_text_layer() {
        let pdf = tiny_pdf("0.5 w 10 10 m 100 100 l S");
        let failure = extract("scan.pdf", "application/pdf", &pdf).unwrap_err();
        match failure {
            ExtractError::NoTextLayer => {}
            other => panic!("expected no text layer, got {other:?}"),
        }
    }

    #[test]
    fn reads_an_xlsx_workbook() {
        let text = extract(
            "table.xlsx",
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            include_bytes!("../tests/fixtures/table.xlsx"),
        )
        .unwrap();
        assert!(text.contains("## Sheet1"), "{text}");
        assert!(text.contains("name, count"), "{text}");
        assert!(text.contains("widgets, 2.5"), "{text}");
    }

    #[test]
    fn reads_an_ods_workbook() {
        let text = extract(
            "table.ods",
            "application/vnd.oasis.opendocument.spreadsheet",
            include_bytes!("../tests/fixtures/table.ods"),
        )
        .unwrap();
        assert!(text.contains("## Sheet1"), "{text}");
        assert!(text.contains("widgets, 2.5"), "{text}");
    }

    #[test]
    fn renders_a_sheet_header_and_rows() {
        let range = Range::from_sparse(vec![
            Cell::new((0, 0), Data::String("name".into())),
            Cell::new((0, 1), Data::String("count".into())),
            Cell::new((1, 0), Data::String("widgets".into())),
            Cell::new((1, 1), Data::Float(2.5)),
        ]);
        let mut out = String::new();
        render_sheet("Sheet1", &range, &mut out);
        assert!(out.starts_with("## Sheet1\n"), "{out}");
        assert!(out.contains("name, count\n"), "{out}");
        assert!(out.contains("widgets, 2.5\n"), "{out}");
    }

    #[test]
    fn renders_excel_dates_as_dates() {
        let stamp =
            calamine::ExcelDateTime::new(45488.0, calamine::ExcelDateTimeType::DateTime, false);
        assert_eq!(sheet_cell(&Data::DateTime(stamp)), "2024-07-15 00:00:00");
    }

    #[test]
    fn skips_a_leading_empty_row() {
        let mut out = String::new();
        render_row(&[Data::Empty, Data::Empty], true, &mut out);
        render_row(
            &[Data::String("name".into()), Data::String("count".into())],
            false,
            &mut out,
        );
        assert_eq!(out, "name, count\n");
    }

    #[test]
    fn renders_ints_booleans_and_flattens_newlines() {
        let mut out = String::new();
        render_row(&[Data::Bool(true), Data::Int(7)], true, &mut out);
        assert_eq!(out, "true, 7\n");

        let mut wrapped = String::new();
        render_row(&[Data::String("two\nlines".into())], true, &mut wrapped);
        assert_eq!(wrapped, "two lines\n");
    }

    #[test]
    fn caps_rows_and_columns_with_a_marker() {
        let rows: Vec<Cell<Data>> = (0..(MAX_SHEET_ROWS + 3))
            .map(|row| Cell::new((row as u32, 0), Data::Int(row as i64)))
            .collect();
        let mut out = String::new();
        render_sheet("Big", &Range::from_sparse(rows), &mut out);
        assert!(out.contains("[more rows omitted]"), "{}", out.len());

        let columns: Vec<Cell<Data>> = (0..(MAX_SHEET_COLS + 4))
            .map(|column| Cell::new((0, column as u32), Data::Int(column as i64)))
            .collect();
        let mut wide = String::new();
        render_sheet("Wide", &Range::from_sparse(columns), &mut wide);
        assert!(wide.contains("[more columns omitted]"), "{}", wide.len());
    }

    #[test]
    fn caps_the_stored_text() {
        let big = "a".repeat(MAX_TEXT_BYTES + 10);
        let capped = cap(big);
        assert!(capped.ends_with("[document truncated at 2097152 bytes]\n"));
        assert!(capped.len() <= MAX_TEXT_BYTES);
    }

    #[test]
    fn treats_empty_input_as_empty() {
        assert_eq!(
            code(extract_guarded("notes.txt", "text/plain", b"")),
            "empty"
        );
        assert_eq!(
            code(extract_guarded("notes.txt", "text/plain", b"   \n")),
            "empty"
        );
    }

    #[test]
    fn contains_a_panicking_extractor() {
        let failure =
            guarded(|| -> ExtractResult<String> { panic!("parser exploded") }).unwrap_err();
        assert_eq!(failure.code, "crashed");
    }
}
