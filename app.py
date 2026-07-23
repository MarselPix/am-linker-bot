import os
import subprocess
import time
import urllib.request

# 1. Unduh dan Ekstrak Node.js Portable untuk Linux x64 jika belum ada
NODE_VERSION = "v20.11.0"
NODE_DIR = f"node-{NODE_VERSION}-linux-x64"
NODE_TAR = f"{NODE_DIR}.tar.xz"
NODE_URL = f"https://nodejs.org/dist/{NODE_VERSION}/{NODE_TAR}"

if not os.path.exists("node_bin"):
    print(f"Downloading Node.js {NODE_VERSION}...")
    try:
        urllib.request.urlretrieve(NODE_URL, NODE_TAR)
        print("Extracting Node.js...")
        subprocess.run(["tar", "-xf", NODE_TAR], check=True)
        os.rename(f"{NODE_DIR}/bin", "node_bin")
        os.remove(NODE_TAR)
        subprocess.run(["rm", "-rf", NODE_DIR])
        print("Node.js setup completed!")
    except Exception as e:
        print(f"Failed to setup Node.js: {e}")

# Tambahkan node_bin ke PATH agar command 'node' dan 'npm' bisa dipanggil
if os.path.exists("node_bin"):
    os.environ["PATH"] = os.path.abspath("node_bin") + os.path.pathsep + os.environ["PATH"]

# 2. Jalankan npm install jika node_modules belum ada
if not os.path.exists("node_modules"):
    print("Installing Node.js dependencies...")
    subprocess.run(["npm", "install", "--omit=dev"], shell=True)

# 3. Jalankan bot Node.js di background
print("Starting Telegram Bot (index.js)...")
bot_process = subprocess.Popen(["node", "index.js"])

# 4. Sediakan interface Gradio sederhana agar Hugging Face Space tetap berjalan
import gradio as gr

def get_status():
    poll_status = bot_process.poll()
    if poll_status is None:
        return "?? Bot Telegram Alight Motion Linker sedang berjalan aktif!"
    else:
        return f"?? Bot Telegram berhenti dengan kode: {poll_status}"

with gr.Blocks(title="AM Linker Bot Status") as demo:
    gr.Markdown("# ?? Alight Motion Linker Bot Status")
    status_box = gr.Textbox(label="Status Bot", value=get_status())
    gr.Markdown("Bot ini berjalan 24/7 secara gratis di background Hugging Face Spaces.")

# Hugging Face Gradio Space mengharuskan server Gradio berjalan di port 7860
demo.queue().launch(server_name="0.0.0.0", server_port=7860)
