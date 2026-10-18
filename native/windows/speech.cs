// Built with Windows' .NET Framework csc. No NuGet packages or PowerShell host.
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Speech.Synthesis;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;

internal static class SwallowSpeech
{
    private const int MaxFrameBytes = 65536;
    private static readonly UTF8Encoding Utf8 = new UTF8Encoding(false, true);
    private static readonly JavaScriptSerializer Json = new JavaScriptSerializer { MaxJsonLength = MaxFrameBytes, RecursionLimit = 8 };
    private static readonly object InputLock = new object();
    private static readonly object CompletionLock = new object();
    private static readonly Queue<InputFrame> Input = new Queue<InputFrame>();
    private static readonly Queue<SpeakCompletedEventArgs> Completions = new Queue<SpeakCompletedEventArgs>();
    private static readonly AutoResetEvent Wake = new AutoResetEvent(false);
    private static StreamWriter Output;
    private static int Closing;
    private static readonly object ParentLock = new object();
    private const uint Synchronize = 0x00100000;
    private const uint WaitTimeout = 0x00000102;

    [DllImport("kernel32.dll", ExactSpelling = true, SetLastError = true)]
    private static extern IntPtr OpenProcess(uint desiredAccess, [MarshalAs(UnmanagedType.Bool)] bool inheritHandle, int processId);
    [DllImport("kernel32.dll", ExactSpelling = true, SetLastError = true)]
    private static extern uint WaitForSingleObject(IntPtr handle, uint milliseconds);
    [DllImport("kernel32.dll", ExactSpelling = true, SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool CloseHandle(IntPtr handle);

    private sealed class InputFrame
    {
        public string Line;
        public bool Eof;
        public bool Invalid;
    }
    private sealed class Chunk
    {
        public string Voice;
        public string Text;
    }
    private sealed class Request
    {
        public int Rate;
        public List<Chunk> Chunks;
    }
    private sealed class Options
    {
        public string Mode;
        public string WaveFile;
        public int ParentPid;
        public bool Echo;
    }
    private sealed class InputException : Exception { }
    private sealed class VoiceException : Exception { }

    private static void Emit(object value)
    {
        Output.WriteLine(Json.Serialize(value));
        Output.Flush();
    }
    private static void Event(string name) { Emit(new { @event = name }); }
    private static int Error(string code)
    {
        try { Emit(new { @event = "error", code = code }); } catch { /* Broken result pipe: never print native diagnostics. */ }
        return 1;
    }
    private static Options ParseOptions(string[] args)
    {
        if (args.Length == 0 || (args[0] != "voices" && args[0] != "speak")) throw new InputException();
        Options options = new Options { Mode = args[0] };
        for (int index = 1; index < args.Length; index++)
        {
            string flag = args[index];
            if (flag == "--parent-pid" && options.ParentPid == 0 && index + 1 < args.Length)
            {
                int pid;
                if (!Int32.TryParse(args[++index], out pid) || pid <= 0) throw new InputException();
                options.ParentPid = pid;
            }
            else if (flag == "--output-wav" && options.Mode == "speak" && options.WaveFile == null && index + 1 < args.Length)
            {
                options.WaveFile = args[++index];
                if (!Path.IsPathRooted(options.WaveFile)) throw new InputException();
            }
            else if (flag == "--selftest-echo" && options.Mode == "speak" && !options.Echo) options.Echo = true;
            else throw new InputException();
        }
        if (options.Echo && options.WaveFile != null) throw new InputException();
        return options;
    }
    private static Dictionary<string, object> ParseObject(string text)
    {
        try
        {
            Dictionary<string, object> value = Json.DeserializeObject(text) as Dictionary<string, object>;
            if (value == null) throw new InputException();
            return value;
        }
        catch (InputException) { throw; }
        catch { throw new InputException(); }
    }
    private static Request ParseRequest(string line)
    {
        Dictionary<string, object> value = ParseObject(line);
        if (value.Count != 2 || !value.ContainsKey("rate") || !value.ContainsKey("chunks") || !(value["rate"] is int)) throw new InputException();
        int rate = (int)value["rate"];
        if (rate != -3 && rate != 0 && rate != 3 && rate != 5) throw new InputException();
        object[] entries = value["chunks"] as object[];
        if (entries == null || entries.Length == 0 || entries.Length > 1800) throw new InputException();
        List<Chunk> chunks = new List<Chunk>();
        StringBuilder combined = new StringBuilder();
        foreach (object entry in entries)
        {
            Dictionary<string, object> chunk = entry as Dictionary<string, object>;
            if (chunk == null || chunk.Count != 2 || !chunk.ContainsKey("voice") || !chunk.ContainsKey("text")) throw new InputException();
            string voice = chunk["voice"] as string;
            string text = chunk["text"] as string;
            if (String.IsNullOrEmpty(voice) || voice.Length > 1024 || String.IsNullOrEmpty(text) || text.Length > 1800) throw new InputException();
            combined.Append(text);
            if (combined.Length > 1800) throw new InputException();
            chunks.Add(new Chunk { Voice = voice, Text = text });
        }
        if (String.IsNullOrWhiteSpace(combined.ToString())) throw new InputException();
        return new Request { Rate = rate, Chunks = chunks };
    }
    private static string ParseCommand(string line)
    {
        Dictionary<string, object> value = ParseObject(line);
        if (value.Count != 1 || !value.ContainsKey("command")) throw new InputException();
        string command = value["command"] as string;
        if (command != "pause" && command != "resume" && command != "stop") throw new InputException();
        return command;
    }
    private static void ReadInput()
    {
        // A background reader leaves the main thread free to process SAPI events and EOF.
        try
        {
            using (StreamReader reader = new StreamReader(Console.OpenStandardInput(), Utf8, false, 4096))
            {
                while (true)
                {
                    StringBuilder line = new StringBuilder();
                    int character;
                    while ((character = reader.Read()) != -1 && character != '\n')
                    {
                        line.Append((char)character);
                        if (line.Length > MaxFrameBytes) throw new InputException();
                    }
                    if (character == -1)
                    {
                        // A truncated JSON frame is invalid; clean EOF cancels any active speech.
                        Enqueue(new InputFrame { Eof = line.Length == 0, Invalid = line.Length != 0 });
                        return;
                    }
                    string text = line.ToString().TrimEnd('\r');
                    if (Utf8.GetByteCount(text) > MaxFrameBytes) throw new InputException();
                    if (!Enqueue(new InputFrame { Line = text })) return;
                }
            }
        }
        catch { Enqueue(new InputFrame { Invalid = true }); }
    }
    private static bool Enqueue(InputFrame frame)
    {
        lock (InputLock)
        {
            if (Input.Count >= 64)
            {
                Input.Clear(); Input.Enqueue(new InputFrame { Invalid = true }); Wake.Set(); return false;
            }
            Input.Enqueue(frame);
        }
        Wake.Set(); return true;
    }
    private static InputFrame NextInput()
    {
        lock (InputLock) { return Input.Count == 0 ? null : Input.Dequeue(); }
    }
    private static SpeakCompletedEventArgs NextCompletion()
    {
        lock (CompletionLock) { return Completions.Count == 0 ? null : Completions.Dequeue(); }
    }
    private static Dictionary<string, VoiceInfo> EnabledVoices(SpeechSynthesizer synth)
    {
        Dictionary<string, VoiceInfo> voices = new Dictionary<string, VoiceInfo>(StringComparer.Ordinal);
        foreach (InstalledVoice voice in synth.GetInstalledVoices())
            if (voice.Enabled && !String.IsNullOrEmpty(voice.VoiceInfo.Id) && !String.IsNullOrEmpty(voice.VoiceInfo.Culture.Name))
                voices[voice.VoiceInfo.Id] = voice.VoiceInfo;
        return voices;
    }
    private static Prompt StartChunk(SpeechSynthesizer synth, Chunk chunk, Dictionary<string, VoiceInfo> voices)
    {
        synth.SelectVoice(voices[chunk.Voice].Name);
        // SelectVoice uses substring name matching. Never silently use a different installed voice.
        if (!String.Equals(synth.Voice.Id, chunk.Voice, StringComparison.Ordinal)) throw new VoiceException();
        return synth.SpeakAsync(chunk.Text);
    }
    private static int Speak(Options options)
    {
        Thread reader = new Thread(ReadInput) { IsBackground = true };
        reader.Start();
        Stopwatch startup = Stopwatch.StartNew();
        Request request = null;
        while (request == null)
        {
            InputFrame frame = NextInput();
            if (frame != null)
            {
                if (frame.Invalid) throw new InputException();
                if (frame.Eof) { Event("done"); return 0; }
                request = ParseRequest(frame.Line);
            }
            else
            {
                if (startup.ElapsedMilliseconds > 5000) throw new InputException();
                Wake.WaitOne(20);
            }
        }
        if (options.Echo)
        {
            StringBuilder text = new StringBuilder();
            foreach (Chunk chunk in request.Chunks) text.Append(chunk.Text);
            using (SHA256 hash = SHA256.Create())
            {
                string digest = BitConverter.ToString(hash.ComputeHash(Utf8.GetBytes(text.ToString()))).Replace("-", "").ToLowerInvariant();
                Emit(new { @event = "echo", sha256 = digest });
            }
            return 0;
        }
        using (SpeechSynthesizer synth = new SpeechSynthesizer())
        {
            Dictionary<string, VoiceInfo> voices = EnabledVoices(synth);
            foreach (Chunk chunk in request.Chunks)
                if (!voices.ContainsKey(chunk.Voice)) throw new VoiceException();
            synth.Rate = request.Rate;
            if (options.WaveFile != null) synth.SetOutputToWaveFile(options.WaveFile);
            else synth.SetOutputToDefaultAudioDevice();
            EventHandler<SpeakCompletedEventArgs> completed = delegate(object sender, SpeakCompletedEventArgs args)
            {
                lock (CompletionLock) { Completions.Enqueue(args); }
                Wake.Set();
            };
            synth.SpeakCompleted += completed;
            try
            {
                int index = 0;
                bool paused = false, pendingNext = false;
                Prompt prompt = StartChunk(synth, request.Chunks[index], voices);
                Event("speaking");
                while (true)
                {
                    // Input is handled before completions so queued stop/pause commands win at a boundary.
                    InputFrame frame = NextInput();
                    if (frame != null)
                    {
                        if (frame.Invalid) throw new InputException();
                        if (frame.Eof) { Event("done"); return 0; }
                        string command = ParseCommand(frame.Line);
                        if (command == "stop") { Event("done"); return 0; }
                        if (command == "pause")
                        {
                            if (!paused) { synth.Pause(); paused = true; }
                            Event("paused");
                        }
                        else
                        {
                            if (paused) { synth.Resume(); paused = false; }
                            if (pendingNext) { prompt = StartChunk(synth, request.Chunks[index], voices); pendingNext = false; }
                            Event("speaking");
                        }
                        continue;
                    }
                    SpeakCompletedEventArgs result = NextCompletion();
                    if (result != null)
                    {
                        if (!Object.ReferenceEquals(result.Prompt, prompt)) continue;
                        if (result.Error != null || result.Cancelled) return Error("audio");
                        index++;
                        if (index == request.Chunks.Count) { Event("done"); return 0; }
                        if (paused) pendingNext = true;
                        else prompt = StartChunk(synth, request.Chunks[index], voices);
                        continue;
                    }
                    Wake.WaitOne(20);
                }
            }
            finally
            {
                synth.SpeakCompleted -= completed;
                synth.SpeakAsyncCancelAll();
                if (synth.State == SynthesizerState.Paused) synth.Resume();
            }
        }
    }
    private static int Run(string[] args)
    {
        Output = new StreamWriter(Console.OpenStandardOutput(), Utf8) { AutoFlush = true };
        IntPtr parent = IntPtr.Zero;
        Timer watcher = null;
        try
        {
            Options options = ParseOptions(args);
            if (options.ParentPid != 0)
            {
                // Open only synchronization access, retaining this handle across PID reuse.
                parent = OpenProcess(Synchronize, false, options.ParentPid);
                if (parent == IntPtr.Zero) throw new InvalidOperationException();
                watcher = new Timer(delegate(object unused)
                {
                    // A zero-time wait and the same lock as CloseHandle prevent use-after-close.
                    lock (ParentLock)
                    {
                        if (Closing != 0) return;
                        try { if (WaitForSingleObject(parent, 0) != WaitTimeout) Environment.Exit(0); }
                        catch { Environment.Exit(0); }
                    }
                }, null, 0, 200);
            }
            if (options.Mode == "speak") return Speak(options);
            using (SpeechSynthesizer synth = new SpeechSynthesizer())
            {
                List<object> result = new List<object>();
                foreach (VoiceInfo voice in EnabledVoices(synth).Values)
                    result.Add(new { id = voice.Id, name = voice.Name, lang = voice.Culture.Name });
                Emit(result); return 0;
            }
        }
        catch (InputException) { return Error("input"); }
        catch (VoiceException) { return Error("voice"); }
        catch { try { return Error("audio"); } catch { return 1; } }
        finally
        {
            lock (ParentLock)
            {
                Closing = 1;
                if (watcher != null) watcher.Dispose();
                if (parent != IntPtr.Zero) { CloseHandle(parent); parent = IntPtr.Zero; }
            }
            try { Output.Dispose(); } catch { /* The parent may already have closed stdout. */ }
        }
    }
    public static int Main(string[] args)
    {
        // Raw stream setup can fail when a policy or a closed pipe blocks the helper.
        try { return Run(args); } catch { return 1; }
    }
}
