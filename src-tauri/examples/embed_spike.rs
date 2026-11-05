use std::path::PathBuf;
use std::time::Instant;

use ort::session::Session;
use ort::session::builder::GraphOptimizationLevel;
use ort::value::Tensor;
use tokenizers::Tokenizer;

fn mean_pool(data: &[f32], shape: &[i64], mask: &[i64]) -> Vec<Vec<f32>> {
    let batch = shape[0] as usize;
    let seq = shape[1] as usize;
    let hidden = shape[2] as usize;
    let mut out = Vec::with_capacity(batch);
    for b in 0..batch {
        let mut vector = vec![0.0f32; hidden];
        let mut count = 0.0f32;
        for t in 0..seq {
            if mask[b * seq + t] == 0 {
                continue;
            }
            count += 1.0;
            for h in 0..hidden {
                vector[h] += data[(b * seq + t) * hidden + h];
            }
        }
        if count > 0.0 {
            for value in &mut vector {
                *value /= count;
            }
        }
        let norm = vector.iter().map(|v| v * v).sum::<f32>().sqrt();
        if norm > 0.0 {
            for value in &mut vector {
                *value /= norm;
            }
        }
        out.push(vector);
    }
    out
}

fn cosine(a: &[f32], b: &[f32]) -> f32 {
    a.iter().zip(b).map(|(x, y)| x * y).sum()
}

fn embed(
    session: &mut Session,
    tokenizer: &Tokenizer,
    texts: &[&str],
    token_type_ids: bool,
) -> Result<Vec<Vec<f32>>, String> {
    let encodings = tokenizer
        .encode_batch(texts.to_vec(), true)
        .map_err(|error| error.to_string())?;
    let max_len = encodings
        .iter()
        .map(|e| e.get_ids().len())
        .max()
        .unwrap_or(1);
    let batch = texts.len();
    let mut ids = vec![0i64; batch * max_len];
    let mut mask = vec![0i64; batch * max_len];
    for (b, encoding) in encodings.iter().enumerate() {
        for (t, id) in encoding.get_ids().iter().enumerate() {
            ids[b * max_len + t] = *id as i64;
            mask[b * max_len + t] = 1;
        }
    }
    let ids_tensor =
        Tensor::from_array(([batch, max_len], ids)).map_err(|error| error.to_string())?;
    let mask_tensor =
        Tensor::from_array(([batch, max_len], mask.clone())).map_err(|error| error.to_string())?;
    let outputs = if token_type_ids {
        let types = Tensor::from_array(([batch, max_len], vec![0i64; batch * max_len]))
            .map_err(|error| error.to_string())?;
        session
            .run(ort::inputs![
                "input_ids" => ids_tensor,
                "attention_mask" => mask_tensor,
                "token_type_ids" => types,
            ])
            .map_err(|error| error.to_string())?
    } else {
        session
            .run(ort::inputs![
                "input_ids" => ids_tensor,
                "attention_mask" => mask_tensor,
            ])
            .map_err(|error| error.to_string())?
    };
    let output = outputs
        .get("last_hidden_state")
        .ok_or_else(|| "missing last_hidden_state".to_string())?;
    let (shape, data) = output
        .try_extract_tensor::<f32>()
        .map_err(|error| error.to_string())?;
    Ok(mean_pool(data, shape, &mask))
}

fn main() -> Result<(), String> {
    let dir = PathBuf::from(std::env::args().nth(1).ok_or_else(|| {
        "usage: embed_spike <dir with model_quantized.onnx and tokenizer.json>".to_string()
    })?);
    let model = dir.join("model_quantized.onnx");
    let tokenizer_path = dir.join("tokenizer.json");
    if !model.is_file() || !tokenizer_path.is_file() {
        return Err(format!("model files missing in {}", dir.display()));
    }

    let tokenizer = Tokenizer::from_file(&tokenizer_path).map_err(|error| error.to_string())?;
    let environment = ort::init()
        .with_name("embed-spike")
        .with_telemetry(false)
        .build()
        .map_err(|error| error.to_string())?;
    let started = Instant::now();
    let mut session = Session::builder(&environment)
        .map_err(|error| error.to_string())?
        .with_optimization_level(GraphOptimizationLevel::Level3)
        .map_err(|error| error.to_string())?
        .with_intra_threads(4)
        .map_err(|error| error.to_string())?
        .commit_from_file(&model)
        .map_err(|error| error.to_string())?;
    let load_ms = started.elapsed().as_millis();
    let inputs: Vec<String> = session
        .inputs()
        .iter()
        .map(|input| input.name().to_string())
        .collect();
    let outputs: Vec<String> = session
        .outputs()
        .iter()
        .map(|output| output.name().to_string())
        .collect();
    let has_types = inputs.iter().any(|name| name == "token_type_ids");
    println!("load_ms={load_ms} inputs={inputs:?} outputs={outputs:?}");

    let pairs = [
        (
            "CES billing uses Xero as the accounting source of truth",
            "Who is the accounting source of truth for CES?",
        ),
        (
            "CES billing uses Xero as the accounting source of truth",
            "Convert Clicks builds on Softr and Airtable",
        ),
        (
            "Convert Clicks deploys Softr frontends over Airtable with Make and n8n",
            "What stack does the Convert Clicks team use?",
        ),
        (
            "A provider is a 1099 psychologist who performs evaluations",
            "Who performs the psych-ed evaluations for CES?",
        ),
        (
            "The monthly billing cycle runs between the third and sixth of the month",
            "When does the billing cycle run?",
        ),
    ];
    let texts: Vec<&str> = pairs.iter().flat_map(|(a, b)| [*a, *b]).collect();
    let vectors = embed(&mut session, &tokenizer, &texts, has_types)?;
    for (index, (a, b)) in pairs.iter().enumerate() {
        let score = cosine(&vectors[index * 2], &vectors[index * 2 + 1]);
        println!("pair{index}: {score:.4}  | {a} <> {b}");
    }

    let sample = "What's the difference between services and ongoing services for CES?";
    let mut timings = Vec::new();
    for _ in 0..20 {
        let started = Instant::now();
        let _ = embed(&mut session, &tokenizer, &[sample], has_types)?;
        timings.push(started.elapsed().as_micros());
    }
    timings.sort_unstable();
    println!(
        "p50_us={} p95_us={}",
        timings[timings.len() / 2],
        timings[(timings.len() * 95) / 100]
    );
    Ok(())
}
