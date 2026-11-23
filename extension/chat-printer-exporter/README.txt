CHAT PRINTER EXPORTER - install (Chrome / Edge / Brave) by Zeeahan Ali
===================================================================================================
Save the chat you have open on Messenger, Facebook, Instagram, X, Telegram Web, LinkedIn or Discord.
(For WhatsApp chats use the website https://chatprinter.vercel.app)

1. Unzip this folder.
2. Open chrome://extensions  (Edge: edge://extensions)
3. Turn on "Developer mode" (top right).
4. Click "Load unpacked" and select the unzipped "chat-printer-exporter" folder.
5. Open the site, open ONE chat, refresh the page (F5).
6. Click the extension icon:
   - "Test detection"  -> green outlines show which messages were found
   - "Pick chat area manually" -> click one message if auto-detect picks the wrong area
   - "Look of exported chat" -> Chat Printer (WhatsApp look, light or dark) or the platform's own look
   - "Export this chat" -> choose format (HTML, TXT, JSON) and with or without media

Everything runs inside your browser. Nothing is uploaded anywhere.
The extension asks for: "storage" (remembers your last options) and access to the listed chat sites
and their picture/video servers, only to read the chat you open and to download its media when you ask.

Firefox and Safari are not supported (this is a Chrome-style Manifest V3 extension).
If a site changes its layout the export can stop working until the extension is updated:
the functions to adjust are findChat() and extractRow() in content.js.
