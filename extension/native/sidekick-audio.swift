// Sidekick native audio helper (macOS). Replaces the browser console's mic and speaker.
//   stdout: raw PCM s16le, 16 kHz, mono, from the microphone (echo-cancelled when the system allows it)
//   stdin : messages  [type:1][length:4 LE][payload]
//             'P' payload = [sampleRate:4 LE][PCM s16le mono]   play audio
//             'X' (empty)                                        stop playback now
//             'Q' (empty)                                        quit
//   stderr: status lines, first "ready mic=ok|denied|off aec=on|off"
import AVFoundation
import Foundation

setvbuf(stderr, nil, _IOLBF, 0)
func status(_ s: String) { FileHandle.standardError.write((s + "\n").data(using: .utf8)!) }

let wantMic = !CommandLine.arguments.contains("--no-mic")
let engine = AVAudioEngine()
let player = AVAudioPlayerNode()
let playFormat = AVAudioFormat(commonFormat: .pcmFormatFloat32, sampleRate: 24000, channels: 1, interleaved: false)!
let outQueue = DispatchQueue(label: "sidekick.out")

// Microphone permission
var micState = "off"
if wantMic {
  let sem = DispatchSemaphore(value: 0)
  var granted = false
  AVCaptureDevice.requestAccess(for: .audio) { ok in granted = ok; sem.signal() }
  sem.wait()
  micState = granted ? "ok" : "denied"
}

engine.attach(player)
engine.connect(player, to: engine.mainMixerNode, format: playFormat)

var aec = "off"
if micState == "ok" {
  do { try engine.inputNode.setVoiceProcessingEnabled(true); aec = "on" } catch { status("voice processing unavailable: \(error)") }
  let input = engine.inputNode
  let inFormat = input.outputFormat(forBus: 0)
  let ratio = inFormat.sampleRate / 16000.0
  var acc: Float = 0, n = 0, pos = 0.0
  input.installTap(onBus: 0, bufferSize: 1024, format: inFormat) { buf, _ in
    guard let ch = buf.floatChannelData?[0] else { return }
    var out = [Int16](); out.reserveCapacity(Int(buf.frameLength) / Int(max(1, ratio)) + 2)
    for i in 0..<Int(buf.frameLength) {
      acc += ch[i]; n += 1; pos += 1
      if pos >= ratio {                       // box-filter average = cheap anti-aliased downsample
        pos -= ratio
        let v = max(-1, min(1, acc / Float(n))); acc = 0; n = 0
        out.append(Int16(v < 0 ? v * 32768 : v * 32767))
      }
    }
    let data = out.withUnsafeBufferPointer { Data(buffer: $0) }
    outQueue.async { FileHandle.standardOutput.write(data) }
  }
}

do { engine.prepare(); try engine.start(); player.play() } catch { status("engine failed: \(error)"); exit(2) }
status("ready mic=\(micState) aec=\(aec)")

func readExactly(_ count: Int) -> Data? {
  var data = Data(capacity: count)
  while data.count < count {
    let chunk = FileHandle.standardInput.readData(ofLength: count - data.count)
    if chunk.isEmpty { return nil }
    data.append(chunk)
  }
  return data
}

DispatchQueue.global().async {
  while let head = readExactly(5) {
    let type = head[0]
    let len = Int(head[1]) | Int(head[2]) << 8 | Int(head[3]) << 16 | Int(head[4]) << 24
    let payload = len > 0 ? (readExactly(len) ?? Data()) : Data()
    switch type {
    case UInt8(ascii: "P"):
      guard payload.count > 4 else { continue }
      let rate = Double(payload[0]) + Double(payload[1]) * 256 + Double(payload[2]) * 65536 + Double(payload[3]) * 16777216
      let samples = (payload.count - 4) / 2
      guard samples > 0, let fmt = AVAudioFormat(commonFormat: .pcmFormatFloat32, sampleRate: rate, channels: 1, interleaved: false),
            let buf = AVAudioPCMBuffer(pcmFormat: fmt, frameCapacity: AVAudioFrameCount(samples)) else { continue }
      buf.frameLength = AVAudioFrameCount(samples)
      payload.withUnsafeBytes { raw in
        let p = raw.bindMemory(to: Int16.self)
        for i in 0..<samples { buf.floatChannelData![0][i] = Float(Int16(littleEndian: p[2 + i])) / 32768 }
      }
      if abs(rate - 24000) > 1 { // rare: different rate than the player's connection; convert through a temporary node
        let conv = AVAudioConverter(from: fmt, to: playFormat)!
        let outBuf = AVAudioPCMBuffer(pcmFormat: playFormat, frameCapacity: AVAudioFrameCount(Double(samples) * 24000 / rate) + 8)!
        var given = false
        conv.convert(to: outBuf, error: nil) { _, st in if given { st.pointee = .noDataNow; return nil }; given = true; st.pointee = .haveData; return buf }
        player.scheduleBuffer(outBuf, completionHandler: nil)
      } else { player.scheduleBuffer(buf, completionHandler: nil) }
    case UInt8(ascii: "X"):
      player.stop(); player.play()           // drops everything queued
    case UInt8(ascii: "Q"):
      exit(0)
    default: break
    }
  }
  exit(0) // stdin closed: the extension went away
}
RunLoop.main.run()
