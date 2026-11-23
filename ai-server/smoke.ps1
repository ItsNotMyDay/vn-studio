param(
  [string]$Endpoint = "http://127.0.0.1:8765",
  [string]$ModelPath = $env:VN_MODEL_PATH,
  [string]$ModelId = "qwen_image_2.1_turbo_int8_convrot",
  [string]$Prompt = "anime visual novel character sprite, single character, upper body portrait, centered, facing viewer, young woman, short red hair, green eyes, amber bomber jacket, fair light skin, warm gentle smile, clean lineart, soft cel shading, isolated on plain solid white background, no scenery",
  [string]$Negative = "bad anatomy, extra fingers, extra limbs, blurry, low quality, watermark, signature, text, multiple characters, background scenery, photo, 3d render",
  [int]$Steps = 6,
  [double]$Guidance = 1.0,
  [int]$Width = 512,
  [int]$Height = 768,
  [int]$Seed = -1,
  [int]$TimeoutMin = 60,
  [string]$Out = "$PWD\test-sprite.png"
)
$ErrorActionPreference = "Stop"
[console]::OutputEncoding = [System.Text.Encoding]::UTF8

function Send-AiJson($url, $obj) {
  $json = $obj | ConvertTo-Json -Depth 6 -Compress
  $bytes = [System.Text.Encoding]::UTF8.GetBytes($json)
  return Invoke-RestMethod -Uri $url -Method Post -ContentType "application/json; charset=utf-8" -Body $bytes
}

function Get-AiHealth {
  return Invoke-RestMethod -Uri "$Endpoint/health"
}

function Wait-AiHealth($minutes) {
  $started = Get-Date
  $last = ""
  while ($true) {
    if (((Get-Date) - $started).TotalMinutes -gt $minutes) { throw "Timeout waiting for model load" }
    $h = Get-AiHealth
    if ($h.model_loaded) { return $h }
    if (-not $h.busy -and $h.error) { throw $h.error }
    $msg = "waiting for model... busy=" + $h.busy
    if ($msg -ne $last) { $last = $msg; Write-Host $msg }
    Start-Sleep -Seconds 2
  }
}

function Wait-AiJob($id, $label, $minutes) {
  $started = Get-Date
  $lastStage = ""
  $lastPct = -100
  while ($true) {
    if (((Get-Date) - $started).TotalMinutes -gt $minutes) { throw "Timeout waiting for job $id" }
    $j = Invoke-RestMethod -Uri "$Endpoint/jobs/$id"
    $p = 0
    if ($null -ne $j.progress) { $p = [int][math]::Round($j.progress * 100) }
    if ($p -lt 0) { $p = 0 }
    if ($p -gt 100) { $p = 100 }
    if ($j.stage -ne $lastStage -or $p -ge ($lastPct + 10)) {
      Write-Host ("[{0}] {1} - {2}%" -f $label, $j.stage, $p)
      $lastStage = $j.stage
      $lastPct = $p
    }
    if ($j.state -eq "done") { return $j }
    if ($j.state -eq "error") { throw $j.message }
    if ($j.state -eq "cancelled") { throw "Cancelled" }
    Start-Sleep -Milliseconds 900
  }
}

$h = Get-AiHealth
Write-Host ("GPU: {0} | VRAM: {1} GB | loaded: {2} | busy: {3}" -f $h.gpu_name, $h.vram_gb, $h.model_loaded, $h.busy)
if ($h.error) { Write-Host ("last server error: {0}" -f $h.error) }

if (-not $h.model_loaded) {
  if ($h.busy) {
    Write-Host "Server already busy - waiting for current load job"
    $h = Wait-AiHealth $TimeoutMin
  } else {
    if (-not $ModelPath) { throw "ModelPath is required. Pass -ModelPath or set VN_MODEL_PATH." }
    Write-Host ("Loading model from: {0}" -f $ModelPath)
    $r = Send-AiJson "$Endpoint/model/load" @{ model_id = $ModelId; model_path = $ModelPath }
    Wait-AiJob $r.job_id "LOAD" $TimeoutMin | Out-Null
    $h = Get-AiHealth
  }
  Write-Host ("quant: {0} | strategy: {1}" -f $h.quant, $h.strategy)
}

Write-Host ("Generating {0}x{1}, steps {2}, guidance {3}" -f $Width, $Height, $Steps, $Guidance)
$g = Send-AiJson "$Endpoint/generate" @{
  model_id = $ModelId; prompt = $Prompt; negative_prompt = $Negative
  width = $Width; height = $Height; steps = $Steps; guidance = $Guidance
  seed = $Seed; transparent = $true
}
$res = Wait-AiJob $g.job_id "GEN" $TimeoutMin
[System.IO.File]::WriteAllBytes($Out, [Convert]::FromBase64String($res.result.image_base64))
Write-Host ("Saved: {0} ({1}x{2}, seed {3})" -f $Out, $res.result.width, $res.result.height, $res.result.seed)