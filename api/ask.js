let lastQuery = "";
let nextPage = 1;
let lastPages = 1;

async function ask(q, more=false){
  if (!more) {
    lastQuery = String(q||"").trim();
    nextPage  = 1;
    lastPages = 1;
    if (!lastQuery) return;
    input.value = "";
    addMsg(esc(lastQuery), "user");
  }

  const typing = addTyping();

  let data = null;
  try{
    const url = `${CONFIG.apiBase}/api/ask?q=${encodeURIComponent(lastQuery)}&limit=12&page=${nextPage}`;
    const resp = await fetch(url, { headers: { "Accept": "application/json" }});
    const text = await resp.text();
    try { data = JSON.parse(text); }
    catch {
      typing.remove();
      addMsg(`No pude leer la respuesta del servidor.<br>
              Intenta de nuevo o contacta un asesor.<br>
              <a class="emz-btn emz-btn-link" href="${CONFIG.whatsapp}" target="_blank" rel="nofollow">Contactar por WhatsApp</a>`);
      return;
    }
  }catch{
    typing.remove();
    addMsg(`No me pude conectar al servidor.<br>
            Revisa tu conexión e intenta otra vez 🙏<br>
            <a class="emz-btn emz-btn-link" href="${CONFIG.whatsapp}" target="_blank" rel="nofollow">Contactar por WhatsApp</a>`);
    return;
  }

  typing.remove();

  try{
    if (data?.ok && Array.isArray(data.results) && data.results.length){
      renderResults(data.results);
      lastPages = data.pages || 1;

      if (nextPage < lastPages){
        const moreBtn = document.createElement("button");
        moreBtn.className = "emz-btn emz-btn-ghost";
        moreBtn.textContent = "Ver más resultados";
        moreBtn.onclick = () => { moreBtn.remove(); nextPage++; ask(lastQuery, true); };
        bodyEl.appendChild(moreBtn);
        bodyEl.scrollTop = bodyEl.scrollHeight;
      }
    } else {
      const contact = data?.contact_url || CONFIG.whatsapp;
      const msg = data?.message || "No encontré información sobre eso en nuestra web.";
      addMsg(`${esc(msg)}<br>
              <a class="emz-btn emz-btn-link" href="${contact}" target="_blank" rel="nofollow">Contactar por WhatsApp</a>`);
    }
  }catch{
    addMsg(`Ocurrió un error al mostrar los resultados 😅<br>
            <a class="emz-btn emz-btn-link" href="${CONFIG.whatsapp}" target="_blank" rel="nofollow">Contactar por WhatsApp</a>`);
  }
}
