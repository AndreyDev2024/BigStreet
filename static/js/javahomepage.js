"use strict";
(function () {
    const isReady = () => document.readyState === "loading" ? new Promise(r => document.addEventListener("DOMContentLoaded", r)) : Promise.resolve();
    window.engine = (function () {
    const _boot = window.BIGSTREET_BOOTSTRAP || {};
    const _bootSelectedEventId = Number(_boot.selected_event_id) || null;
    let _eventsPollTimer = null;

    const _safeParse = (key, fallback) => {
        try {
            const raw = localStorage.getItem(key);
            return raw ? JSON.parse(raw) : fallback;
        } catch (_) {
            return fallback;
        }
    };

    // --------------------
    // ESTADO PRINCIPAL
    // --------------------
    const _state = {
        currentUser: {
            id: 1,
            name: "Felipe Silva",
            rank: "Elite Member",
            theme: localStorage.getItem('bs_v12_theme') || 'dark',
            reputation: 4.9,
            gols: 0,
            partidasGanhas: 0,
            photo: localStorage.getItem('bs_v12_profile_photo') || '',
            bio: localStorage.getItem('bs_v12_profile_bio') || 'Jogador de final de semana, gosto de competitividade.',
            favoriteSport: localStorage.getItem('bs_v12_profile_sport') || 'Futebol'
        },
        events: [],
        userSubscriptions: _safeParse('bs_v12_subs', []),
        userOwnedEvents: _safeParse('bs_v12_owned', []),
        userOwnedCourts: _safeParse('bs_v12_owned_courts', []),
        userHistory: _safeParse('bs_v12_history', []),
        currentView: 'dashboard',
        searchQuery: '',
        isSidebarCollapsed: false,
        userCity: null,
        exploreFilters: {
            cidade: '',
            esporte: '',
            faixa: '',
            genero: '',
            data: '',
            buscaLivre: ''
        },
        courtsFilters: {
            cidade: '',
            bairro: '',
            esporte: '',
            tipo: '',
            capacidadeMin: null
        },
        courtBookings: _safeParse('bs_v12_court_bookings', {}),
        userStats: _safeParse('bs_v12_user_stats', { partidas: 0, gols: 0, total: 0 }),
        eventChats: _safeParse('bs_v12_event_chats', {}),
        selectedPrivateSlots: [],
        preferences: _safeParse('bs_v12_preferences', { emailNotifications: true, publicProfile: true, matchReminders: true, darkAtNight: false }),
        publicBaseUrl: '',
        playerFeedback: _safeParse('bs_v12_player_feedback', {}),
        playerReports: _safeParse('bs_v12_player_reports', {}),
        auth: {
            isLoggedIn: !!_boot.usuario_logado,
            isGuestFlow: !!_boot.is_guest,
            guestPresenceConfirmed: !!_boot.guest_presence_confirmed
        },
        selectedEventId: _bootSelectedEventId,
        sportsPositions: {
            "Volei": ["Levantador", "Oposto", "Central", "Ponta", "Líbero"],
            "Futebol": ["Goleiro", "Zagueiro", "Lateral", "Meio-campo", "Atacante"],
            "Basquete": ["Armador", "Ala-armador", "Ala", "Ala-pivô", "Pivô"],
            "Tenis": ["Simples", "Duplas"],
            "Corrida": []
        }
    };

    if (!_state.auth.isLoggedIn) {
        _state.currentUser.id = 0;
        _state.currentUser.name = "Convidado";
        _state.currentUser.rank = "Visitante";
        _state.currentUser.photo = "";
    }

    const _hasEventEnded = (ev) => {
        if (ev && ev.finalizado) return true;
        const dateStr = (ev && (ev.data_evento || ev.data)) || "";
        const ht = ev && ev.horario_termino;
        if (!dateStr || !ht) return false;
        const hs = String(ht).trim();
        if (hs.length >= 19 && hs[4] === "-" && hs.includes(" ")) {
            const end = new Date(hs.slice(0, 19).replace(" ", "T"));
            return !Number.isNaN(end.getTime()) && end.getTime() < Date.now();
        }
        const tail = hs.includes(" ") ? hs.split(/\s+/).pop() : hs;
        const timePart = tail.length >= 5 ? tail.slice(0, 8) : `${tail}:00`;
        const end = new Date(`${String(dateStr).slice(0, 10)}T${timePart.slice(0, 5)}:00`);
        return !Number.isNaN(end.getTime()) && end.getTime() < Date.now();
    };

    const _mapServerEventRow = (row) => {
        if (!row || typeof row !== "object") {
            throw new Error("Linha de evento inválida");
        }
        const creatorId = Number(row.usuario_id);
        const apiParts = row.participantes_api || [];
        const guestApiParts = row.convidados_api || [];
        let players = apiParts.filter((p) => p.papel === "jogador").map((p) => Number(p.usuario_id));
        const spectators = apiParts.filter((p) => p.papel === "espectador").map((p) => Number(p.usuario_id));
        const guestParticipants = guestApiParts.map((guest) => ({
            id: `guest-${guest.guest_id ?? guest.cpf ?? guest.nome_guest ?? Date.now()}`,
            guestId: guest.guest_id ?? null,
            nome: guest.nome_guest || "Convidado",
            cpf: guest.cpf ?? null,
            idade: guest.idade ?? null,
            peso: guest.peso ?? null,
            altura: guest.altura ?? null,
            isGuest: true
        }));
        if (!players.includes(creatorId)) players = [...players, creatorId];
        const participantes = [...new Set([...players, ...spectators, creatorId])];
        const participantNames = {};
        participantes.forEach((pid) => {
            const fromApi = apiParts.find((p) => Number(p.usuario_id) === Number(pid));
            const nm = fromApi && fromApi.nome_user ? fromApi.nome_user : null;
            participantNames[pid] =
                pid === creatorId ? (row.criador_nome || "Criador") : (nm || `Jogador ${pid}`);
        });
        const finalizado = row.finalizado === true || row.finalizado === 1 || _hasEventEnded({
            data_evento: row.data_evento,
            data: row.data_evento,
            horario_termino: row.horario_termino,
            finalizado: row.finalizado
        });
        return {
            id: row.id_evento != null ? row.id_evento : row.id,
            nome: row.nome_evento,
            nome_evento: row.nome_evento,
            esporte: row.esporte_evento,
            genero: row.genero,
            faixa_etaria: row.faixa_etaria,
            descricao: row.descricao_evento,
            data_evento: row.data_evento,
            data: row.data_evento,
            horario_inicio: row.horario_inicio,
            horario_termino: row.horario_termino,
            cidade: row.cidade_evento,
            bairro: row.bairro_evento,
            rua: row.rua_evento,
            cep: row.cep_evento,
            numero: row.numero_evento,
            latitude: row.latitude_evento != null ? Number(row.latitude_evento) : null,
            longitude: row.longitude_evento != null ? Number(row.longitude_evento) : null,
            valor: Number(row.valor_aluguel || 0),
            pix: row.pix,
            banco: row.banco,
            titular: row.beneficiario,
            max: row.max_jogadorees || 10,
            quadra_id: row.quadra_id,
            usuario_id: creatorId,
            creatorId,
            creatorName: row.criador_nome || "—",
            players,
            spectators,
            guestParticipants,
            participantes,
            participantNames,
            ocupadas: participantes.length + guestParticipants.length,
            finalizado
        };
    };

    const _mapServerCourtRow = (q) => ({
        id: q.id_quadra,
        nome: q.nome_quadra,
        rua: q.rua_quadra,
        numero: q.numero_quadra,
        cidade: q.cidade_quadra,
        bairro: q.bairro_quadra,
        cep: q.cep_quadra,
        estado: q.estado_quadra,
        esporte: q.esporte_quadra,
        capacidade: q.capacidade,
        tipo: "Quadra Alugada",
        preco_30min: 25,
        ownerId: q.usuario_id,
        ownerName: q.dono_nome || "—",
        disponibilidade: { dias: ["seg", "ter", "qua", "qui", "sex", "sab"], inicio: "08:00", fim: "22:00" },
        weekSchedule: []
    });

    const fetchEvents = async ({ silent = false } = {}) => {
        let evRes;
        try {
            evRes = await fetch("/eventos", { credentials: "include" });
        } catch (error) {
            console.error("Falha de rede ao buscar /eventos:", error);
            if (!silent) _showToast("Erro de conexão ao buscar eventos.");
            throw error;
        }

        const rawText = await evRes.text();
        let payload = null;
        try {
            payload = rawText ? JSON.parse(rawText) : [];
        } catch (error) {
            console.error("Resposta inválida da API /eventos:", evRes.status, rawText);
            if (!silent) _showToast("A API de eventos respondeu em formato inválido.");
            throw error;
        }

        if (!evRes.ok) {
            console.error("Falha ao buscar /eventos:", evRes.status, payload);
            if (!silent) _showToast((payload && payload.message) || "Não foi possível carregar os eventos.");
            throw new Error(`Falha /eventos: ${evRes.status}`);
        }

        const arr = Array.isArray(payload)
            ? payload
            : (payload && Array.isArray(payload.eventos) ? payload.eventos : null);

        if (!Array.isArray(arr)) {
            console.error("Formato inesperado recebido em /eventos:", payload);
            if (!silent) _showToast("Formato inesperado ao carregar os eventos.");
            throw new Error("Formato inesperado para /eventos");
        }

        const mapped = [];
        for (const row of arr) {
            try {
                if (row && (row.id_evento != null || row.id != null)) {
                    mapped.push(_mapServerEventRow(row));
                }
            } catch (err) {
                console.warn("Evento ignorado (map):", err, row);
            }
        }

        _state.events = mapped;
        _writeStorage("events", _state.events, "global");

        if (!arr.length) {
            console.error("A API /eventos retornou uma lista vazia. Solicitando diagnóstico...");
            try {
                const debugRes = await fetch("/eventos?debug=1", { credentials: "include" });
                const debugPayload = await debugRes.json();
                console.error("Diagnóstico /eventos:", debugPayload);
            } catch (debugError) {
                console.error("Falha ao obter diagnóstico de /eventos:", debugError);
            }
        }

        return mapped;
    };

    const _loadServerData = async ({ skipEvents = false, silent = true } = {}) => {
        try {
            const eventsPromise = skipEvents ? Promise.resolve(_state.events) : fetchEvents({ silent });
            const qRes = await fetch("/quadras", { credentials: "include" });
            await eventsPromise;
            if (qRes.ok) {
                try {
                    const qdata = await qRes.json();
                    if (qdata && qdata.success && Array.isArray(qdata.quadras) && qdata.quadras.length) {
                        _courts = qdata.quadras.map(_mapServerCourtRow);
                    }
                } catch (_) {}
            }
            if (_state.auth.isLoggedIn) {
                await _loadDashboardFromApi();
                await _loadFriendsDropdown();
            }
        } catch (e) {
            console.warn("Sync servidor:", e);
        }
    };

    const _loadDashboardFromApi = async () => {
        try {
            const r = await fetch("/api/dashboard-resumo", { credentials: "include" });
            const d = await r.json();
            if (!r.ok || !d.success) return;
            const repValue = Number(d.reputacao_partidas ?? 5);
            const pg = document.getElementById("dashPartidasGanhas");
            const rep = document.getElementById("dashRepPartidas");
            const evc = document.getElementById("dashEventosCriados");
            const gols = document.getElementById("dashGols");
            const qlist = document.getElementById("dashQuadrasFreqList");
            if (Number.isFinite(repValue)) _state.currentUser.reputation = repValue;
            if (Number.isFinite(Number(d.gols))) _state.currentUser.gols = Number(d.gols);
            _state.currentUser.reputationMeta = {
                jogosLimpos: Number(d.jogos_limpos ?? 0),
                reportsRecebidos: Number(d.reports_recebidos ?? 0),
                partidasReputacao: Number(d.partidas_reputacao ?? 0)
            };
            if (pg) pg.textContent = String(d.partidas_ganhas ?? 0);
            if (rep) rep.textContent = (Number.isFinite(repValue) ? repValue : 0).toFixed(1);
            if (evc) evc.textContent = String(d.eventos_criados ?? 0);
            if (gols) gols.textContent = String(d.gols ?? 0);
            if (qlist) {
                const items = (d.quadras_mais_frequentadas || [])
                    .map((x) => `<li>${x.nome}${x.total_eventos ? ` (${x.total_eventos} eventos)` : ""}</li>`)
                    .join("");
                qlist.innerHTML = items || "<li>—</li>";
            }
            _renderStats();
        } catch (_) {}
    };

    const _solicitarAmizadeUsuario = async (destId) => {
        const id = Number(destId);
        if (!id) { _showToast('Escolha um jogador.'); return; }
        try {
            const r = await fetch("/api/amizades", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                credentials: "include",
                body: JSON.stringify({ destinatario_id: id })
            });
            const d = await r.json();
            if (d.success) { _showToast("Pedido de amizade enviado!"); _loadFriendsDropdown(); }
            else _showToast(d.message || "Não foi possível enviar.");
        } catch (_) { _showToast("Erro de rede."); }
    };

    const _fillInviteToEventSelects = () => {
        const evSel = document.getElementById("inviteToEventSelect");
        const uSel = document.getElementById("inviteToEventUserSelect");
        if (!evSel || !uSel) return;
        const mine = (_state.events || []).filter(
            (e) => Number(e.creatorId) === Number(_state.currentUser.id) && !_hasEventEnded(e)
        );
        evSel.innerHTML =
            '<option value="">Seu evento (em aberto)...</option>' +
            mine.map((e) => `<option value="${e.id}">${(e.nome || "").slice(0, 42)}</option>`).join("");
        fetch("/api/amizades/lista", { credentials: "include" })
            .then((r) => r.json())
            .then((d) => {
                const amigos = d.amigos || [];
                uSel.innerHTML =
                    '<option value="">Amigo...</option>' +
                    amigos.map((a) => `<option value="${a.amigo_id}">${a.nome}</option>`).join("");
            })
            .catch(() => { uSel.innerHTML = '<option value="">—</option>'; });
    };

    const _loadFriendsDropdown = async () => {
        const reqEl = document.getElementById("profileFriendRequests");
        const listEl = document.getElementById("profileFriendsList");
        const sel = document.getElementById("inviteSiteUserSelect");
        const recentEl = document.getElementById("profileRecentPlayers");
        if (!reqEl || !listEl) return;
        try {
            const reqs = [
                fetch("/api/amizades/pendentes", { credentials: "include" }),
                fetch("/api/amizades/lista", { credentials: "include" }),
                fetch("/api/usuarios", { credentials: "include" }),
                fetch("/api/jogadores/recentes-finalizados", { credentials: "include" })
            ];
            const [pend, lista, users, recent] = await Promise.all(reqs);
            const pj = pend.ok ? await pend.json() : {};
            const lj = lista.ok ? await lista.json() : {};
            const uj = users.ok ? await users.json() : {};
            const rj = recent.ok ? await recent.json() : {};
            const inc = (pj.recebidas || []).map(
                (x) => `
                <div class="friend-req-row">
                    <span>${x.solicitante_nome}</span>
                    <button type="button" class="btn-modal-submit" onclick="engine.logic.aceitarAmizade(${x.id_amizade})">Aceitar</button>
                    <button type="button" class="btn-card-secondary-outline" onclick="engine.logic.recusarAmizade(${x.id_amizade})">Recusar</button>
                </div>`
            );
            reqEl.innerHTML = inc.length ? `<div class="friend-req-title">Pedidos recebidos</div>${inc.join("")}` : "";
            const amigos = (lj.amigos || [])
                .map((a) => `<div class="friend-chip" role="button" onclick="engine.logic.verPerfil(${a.amigo_id})">${a.nome}</div>`)
                .join("");
            listEl.innerHTML = amigos ? `<div class="friend-req-title">Seus amigos</div>${amigos}` : "";
            if (sel) {
                const opts = (uj.usuarios || [])
                    .map((u) => `<option value="${u.id_usuario}">${u.nome_user}</option>`)
                    .join("");
                sel.innerHTML = `<option value="">Escolha um jogador</option>${opts}`;
            }
            if (recentEl) {
                const jog = rj.jogadores || [];
                recentEl.innerHTML = jog.length
                    ? jog
                          .map(
                              (j) =>
                                  `<div class="friend-req-row friend-req-row--compact">
                <span>${j.nome_user}</span>
                <button type="button" class="btn-modal-submit" onclick="engine.logic.solicitarAmizadeUsuario(${j.id_usuario})">Adicionar</button>
                <button type="button" class="btn-card-secondary-outline" onclick="engine.logic.verPerfil(${j.id_usuario})">Ver</button>
              </div>`
                          )
                          .join("")
                    : '<p class="participants-empty-text" style="margin:0;font-size:12px;">Nenhum jogador recente (eventos finalizados).</p>';
            }
            _fillInviteToEventSelects();
        } catch (_) {
            reqEl.innerHTML = "";
            listEl.innerHTML = "";
            if (recentEl) recentEl.innerHTML = "";
        }
    };

    // --------------------
    // DADOS DE EXEMPLO (SEED)
    // --------------------
    let _courts = [
        { id: 1, nome: "Arena Vila Aurora", cidade: "Belo Horizonte", bairro: "Savassi", rua: "Rua Aurora, 120", numero: "120", cep: "30140-110", estado: "MG", esporte: "Futebol", capacidade: 14, tipo: "Quadra Alugada", preco_30min: 25, ownerId: 1, ownerName: "Felipe Silva", disponibilidade: { dias: ["seg","ter","qua","qui","sex","sab"], inicio: "18:00", fim: "23:00" }, weekSchedule: [{dia:"seg",inicio:"18:00",fim:"23:00"},{dia:"ter",inicio:"18:00",fim:"23:00"},{dia:"qua",inicio:"18:00",fim:"23:00"},{dia:"qui",inicio:"18:00",fim:"23:00"},{dia:"sex",inicio:"18:00",fim:"23:00"},{dia:"sab",inicio:"08:00",fim:"22:00"},{dia:"dom",fechado:true,inicio:"",fim:""}] },
        { id: 2, nome: "Quadra Parque Central", cidade: "Contagem", bairro: "Centro", rua: "Av. Central, 88", numero: "88", cep: "32040-100", estado: "MG", esporte: "Basquete", capacidade: 10, tipo: "Quadra Alugada", preco_30min: 30, ownerId: 3, ownerName: "Rafael Dias", disponibilidade: { dias: ["seg","ter","qua","qui","sex","sab","dom"], inicio: "09:00", fim: "21:00" }, weekSchedule: [{dia:"seg",inicio:"09:00",fim:"21:00"},{dia:"ter",inicio:"09:00",fim:"21:00"},{dia:"qua",inicio:"09:00",fim:"21:00"},{dia:"qui",inicio:"09:00",fim:"21:00"},{dia:"sex",inicio:"09:00",fim:"21:00"},{dia:"sab",inicio:"09:00",fim:"18:00"},{dia:"dom",inicio:"09:00",fim:"14:00"}] },
        { id: 3, nome: "Complexo Praia Vôlei", cidade: "Betim", bairro: "Jardim", rua: "Rua das Areias, 45", numero: "45", cep: "32610-250", estado: "MG", esporte: "Volei", capacidade: 12, tipo: "Quadra Alugada", preco_30min: 20, ownerId: 1, ownerName: "Felipe Silva", disponibilidade: { dias: ["ter","qua","qui","sex","sab"], inicio: "08:00", fim: "20:00" }, weekSchedule: [{dia:"seg",fechado:true,inicio:"",fim:""},{dia:"ter",inicio:"08:00",fim:"20:00"},{dia:"qua",inicio:"08:00",fim:"20:00"},{dia:"qui",inicio:"08:00",fim:"20:00"},{dia:"sex",inicio:"08:00",fim:"20:00"},{dia:"sab",inicio:"08:00",fim:"18:00"},{dia:"dom",fechado:true,inicio:"",fim:""}] },
        { id: 4, nome: "Arena Noturna Leste", cidade: "São Paulo", bairro: "Mooca", rua: "Rua da Mooca, 500", numero: "500", cep: "03104-000", estado: "SP", esporte: "Futebol", capacidade: 12, tipo: "Quadra Alugada", preco_30min: 35, ownerId: 8, ownerName: "Felipe Santos", disponibilidade: { dias: ["seg","ter","qua","qui","sex"], inicio: "19:00", fim: "23:30" }, weekSchedule: [{dia:"seg",inicio:"19:00",fim:"23:30"},{dia:"ter",inicio:"19:00",fim:"23:30"},{dia:"qua",inicio:"19:00",fim:"23:30"},{dia:"qui",inicio:"19:00",fim:"23:30"},{dia:"sex",inicio:"19:00",fim:"23:30"},{dia:"sab",fechado:true,inicio:"",fim:""},{dia:"dom",fechado:true,inicio:"",fim:""}] },
        { id: 5, nome: "Quadra Azul Ibirapuera", cidade: "São Paulo", bairro: "Ibirapuera", rua: "Alameda Azul, 210", numero: "210", cep: "04094-050", estado: "SP", esporte: "Basquete", capacidade: 8, tipo: "Quadra Alugada", preco_30min: 28, ownerId: 5, ownerName: "Carlos Mendes", disponibilidade: { dias: ["seg","ter","qua","qui","sex","sab"], inicio: "10:00", fim: "22:00" }, weekSchedule: [{dia:"seg",inicio:"10:00",fim:"22:00"},{dia:"ter",inicio:"10:00",fim:"22:00"},{dia:"qua",inicio:"10:00",fim:"22:00"},{dia:"qui",inicio:"10:00",fim:"22:00"},{dia:"sex",inicio:"10:00",fim:"22:00"},{dia:"sab",inicio:"09:00",fim:"20:00"},{dia:"dom",fechado:true,inicio:"",fim:""}] }
    ];

    const _players = {
        1: { id: 1, nome: "Lucas Oliveira", idade: 27, posicao: "Atacante", cidade: "Juatuba", bairro: "Francelinos", bio: "Craque do racha de quarta, bom de grupo e sempre presente." },
        2: { id: 2, nome: "Mariana Souza", idade: 24, posicao: "Meia", cidade: "Juatuba", bairro: "Centro", bio: "Organizadora de partidas, focada em inclusão e fair play." },
        3: { id: 3, nome: "Rafael Dias", idade: 29, posicao: "Goleiro", cidade: "Juatuba", bairro: "Francelinos", bio: "Goleiro raiz, não foge de dividida." },
        4: { id: 4, nome: "Ana Paula", idade: 22, posicao: "Levantadora", cidade: "Betim", bairro: "Parque", bio: "Apaixonada por vôlei de areia e torneios amadores." },
        5: { id: 5, nome: "Carlos Mendes", idade: 31, posicao: "Armador", cidade: "Contagem", bairro: "Riacho", bio: "Líder do time de basquete noturno da região." },
        6: { id: 6, nome: "João Pedro", idade: 19, posicao: "Zagueiro", cidade: "Juatuba", bairro: "Satélite", bio: "Novo na região, procura rachas para jogar toda semana." },
        7: { id: 7, nome: "Beatriz Lima", idade: 26, posicao: "Ponteira", cidade: "Belo Horizonte", bairro: "Pampulha", bio: "Joga vôlei competitivo e amistosos aos fins de semana." },
        8: { id: 8, nome: "Felipe Santos", idade: 28, posicao: "Ala", cidade: "São Paulo", bairro: "Moema", bio: "Viciado em streetball, viaja sempre que pode para jogar." },
        9: { id: 9, nome: "Juliana Costa", idade: 30, posicao: "Meia ofensiva", cidade: "Igarapé", bairro: "Centro", bio: "Participa de ligas amadoras femininas na região." },
        10: { id: 10, nome: "Pedro Henrique", idade: 21, posicao: "Volante", cidade: "Mateus Leme", bairro: "Boa Vista", bio: "Marca forte e organiza o meio de campo." }
    };

    const _initialSeed = [
        { id: 2001, nome: "Pelada do Horto", esporte: "Futebol", genero: "Misto", faixa_etaria: "16+", max: 14, ocupadas: 3, descricao: "Racha regional em Betim com ponto de encontro na Rua Jose de Alencar.", cidade: "Betim", bairro: "Regional Sede", rua: "Rua Jose de Alencar", cep: "32655040", valor: 0, banco: "", titular: "", pix: "", participantes: [1,2,3], data_evento: "2026-03-28", horario_inicio: "08:00", horario_termino: "10:00", creatorId: 1, creatorName: "Andey", latitude: -19.9746822, longitude: -44.1783671 },
        { id: 2002, nome: "Basquete na Praca", esporte: "Basquete", genero: "Misto", faixa_etaria: "14+", max: 10, ocupadas: 3, descricao: "3x3 aberto na Praca Milton Campos com rotacao rapida de times.", cidade: "Betim", bairro: "Regional Sede", rua: "Praca Milton Campos", cep: "32600134", valor: 0, banco: "", titular: "", pix: "", participantes: [4,5,6], data_evento: "2026-03-29", horario_inicio: "17:00", horario_termino: "19:00", creatorId: 2, creatorName: "Gabriel Felipe", latitude: -19.9720292, longitude: -44.1941260 },
        { id: 2003, nome: "Volei de Areia", esporte: "Volei", genero: "Misto", faixa_etaria: "16+", max: 12, ocupadas: 3, descricao: "Partida na orla da Pampulha com encontro pela Avenida Otacilio Negrao de Lima.", cidade: "Belo Horizonte", bairro: "Sao Luiz", rua: "Avenida Otacilio Negrao de Lima", numero: 1350, cep: "31310082", valor: 0, banco: "", titular: "", pix: "", participantes: [4,7,9], data_evento: "2026-04-02", horario_inicio: "07:30", horario_termino: "09:30", creatorId: 2, creatorName: "Gabriel Felipe", latitude: -19.8533828, longitude: -43.9747851 },
        { id: 2004, nome: "Treino Aberto", esporte: "Corrida", genero: "Misto", faixa_etaria: "Livre", max: 30, ocupadas: 3, descricao: "Treino funcional e corrida leve com encontro na Praca da Liberdade.", cidade: "Belo Horizonte", bairro: "Savassi", rua: "Praca da Liberdade", cep: "30140140", valor: 0, banco: "", titular: "", pix: "", participantes: [7,8,9], data_evento: "2026-04-04", horario_inicio: "06:30", horario_termino: "08:00", creatorId: 1, creatorName: "Andey", latitude: -19.9318722, longitude: -43.9380410 },
        { id: 2005, nome: "Futsal de Domingo", esporte: "Futebol", genero: "Misto", faixa_etaria: "16+", max: 12, ocupadas: 3, descricao: "Pelada de domingo em Contagem com concentracao na Avenida Joao Cesar de Oliveira.", cidade: "Contagem", bairro: "Eldorado", rua: "Avenida Joao Cesar de Oliveira", cep: "32315040", valor: 0, banco: "", titular: "", pix: "", participantes: [2,5,10], data_evento: "2026-04-05", horario_inicio: "09:00", horario_termino: "11:00", creatorId: 2, creatorName: "Gabriel Felipe", latitude: -19.9412912, longitude: -44.0427820 }
    ];

    // --------------------
    // INICIALIZAÇÃO
    // --------------------
    const _resetModalsAndOverlay = () => {
        document.querySelectorAll(".modal-system-root").forEach((m) => m.classList.remove("active"));
        const o = document.getElementById("globalOverlay");
        if (o) o.classList.remove("active");
        document.body.style.overflow = "auto";
    };

    const _setupClickDelegation = () => {
        document.body.addEventListener("click", (e) => {
            const t = e.target;
            const closest = (sel) => t.closest ? t.closest(sel) : (t.matches && t.matches(sel) ? t : (t.parentElement && t.parentElement.closest ? t.parentElement.closest(sel) : null));
            const navItem = closest(".nav-link-item[data-view]");
            if (navItem) {
                e.preventDefault();
                e.stopPropagation();
                const view = navItem.getAttribute("data-view");
                if (!view) return;
                document.querySelectorAll(".viewport-section").forEach((s) => s.classList.remove("active"));
                document.querySelectorAll(".nav-link-item").forEach((l) => l.classList.remove("active"));
                const section = document.getElementById("view-" + view);
                if (section) section.classList.add("active");
                navItem.classList.add("active");
                _state.currentView = view;
                if (view === "quadras" && !_state.userCity && typeof _initGeolocation === "function") _initGeolocation();
                else if (view === "quadras" && typeof _renderCourts === "function") _renderCourts();
                return;
            }
            if (closest("#triggerCreateModal")) {
                e.preventDefault();
                const hid = document.getElementById("sql_edit_event_id");
                if (hid) hid.value = "";
                _openModal("createModal");
                if (typeof _toggleMenuPaymentFields === "function") _toggleMenuPaymentFields();
                return;
            }
            if (closest("#triggerCreateCourtModal")) {
                e.preventDefault();
                window._editingCourtId = null;
                _openModal("createCourtModal");
                return;
            }
            if (closest("#profileMenuTrigger")) {
                e.preventDefault();
                e.stopPropagation();
                _toggleProfileDropdown();
                return;
            }
            if (closest(".modal-close-x") || closest("[data-close-modal]")) {
                const modal = closest(".modal-system-root");
                if (modal) _closeModal(modal.id);
                return;
            }
            const sportTab = closest(".sports-tab-btn[data-sport-tab]");
            if (sportTab) {
                const sport = sportTab.getAttribute("data-sport-tab");
                document.querySelectorAll(".sports-tab-btn").forEach((b) => b.classList.remove("active"));
                document.querySelectorAll(".sports-tab-pane").forEach((p) => p.classList.remove("active"));
                sportTab.classList.add("active");
                const pane = document.getElementById("sportTab" + (sport ? sport.charAt(0).toUpperCase() + sport.slice(1) : ""));
                if (pane) pane.classList.add("active");
                return;
            }
        });
    };

    const _ensureSeedEvents = () => {
        const evs = _initialSeed.map((ev) => ({
            ...ev,
            creatorId: ev.creatorId || 1,
            creatorName: ev.creatorName || "Felipe Silva",
            players: ev.players || ev.participantes || [Number(ev.creatorId || 1)],
            participantes: ev.participantes || ev.players || [Number(ev.creatorId || 1)],
            participantNames: ev.participantNames || Object.fromEntries((ev.participantes || []).map((pid) => [pid, (_players[pid]?.nome) || `Jogador ${pid}`])),
            spectators: ev.spectators || []
        }));
        evs.forEach((e) => _recalculateEventOccupancy(e));
        return evs;
    };

    const init = async () => {
        _resetModalsAndOverlay();
        _setupClickDelegation();
        try {
            _loadPersistentData();
        } catch (e) {
            console.warn("loadPersistentData:", e);
        }
        if (!Array.isArray(_state.events) || _state.events.length === 0) {
            _state.events = _ensureSeedEvents();
            try { _writeStorage("events", _state.events, "global"); } catch (_) {}
        }
        _applyTheme(_state.currentUser.theme);
        _renderProfileInitials();
        _renderCourts();
        _renderStats();
        try {
            _renderAll();
        } catch (err) {
            console.error("Erro ao renderizar:", err);
        }
        _showToast("Bem-vindo, " + (_state.currentUser?.name || "Atleta") + "!");
        try {
            _setupDOMListeners();
            _applyAccessMode();
        } catch (err) {
            console.error("Falha em _setupDOMListeners:", err);
        }
        _setupSportsForm();
        _resetModalsAndOverlay();
        (async () => {
            try {
                await _loadPublicBaseUrl();
                await _loadCurrentUserFromAPI();
                await fetchEvents({ silent: true });
                await _loadServerData({ skipEvents: true, silent: true });
                _renderProfileInitials();
                _renderCourts();
                _renderStats();
                _renderAll();
                _handleInviteFromUrl();
                _startEventsPolling();
            } catch (_) {}
        })();
        if (_state.selectedEventId && _state.auth.isGuestFlow && !_state.auth.guestPresenceConfirmed) {
            _openGuestPresenceModal();
        }
    };

    const _loadUserScopedState = () => {
        _state.userSubscriptions = _readStorage('subs', []);
        _state.userOwnedEvents = _readStorage('owned', []);
        _state.userOwnedCourts = _readStorage('owned_courts', []);
        _state.userHistory = _readStorage('history', []);
        _state.userStats = _readStorage('stats', { partidas: 0, gols: 0, total: 0, vitorias: 0 });
        _state.preferences = _readStorage('preferences', { emailNotifications: true, publicProfile: true, matchReminders: true, darkAtNight: false });
        _state.currentUser.photo = localStorage.getItem(_storageKey('profile_photo')) || _state.currentUser.photo || '';
        _state.currentUser.bio = localStorage.getItem(_storageKey('profile_bio')) || _state.currentUser.bio || 'Jogador de final de semana, gosto de competitividade.';
        _state.currentUser.favoriteSport = localStorage.getItem(_storageKey('profile_sport')) || _state.currentUser.favoriteSport || 'Futebol';
    };

    const _recalculateEventOccupancy = (ev) => {
        const uniqueParticipants = [...new Set([...(ev.players || []), ...(ev.spectators || [])])];
        const guestCount = Array.isArray(ev.guestParticipants) ? ev.guestParticipants.length : 0;
        ev.ocupadas = uniqueParticipants.length + guestCount;
        ev.participantes = uniqueParticipants;
        return ev.ocupadas;
    };

    const _refreshCurrentUserNameEverywhere = (oldName) => {
        _state.events.forEach(ev => {
            if (Number(ev.creatorId) === Number(_state.currentUser.id)) {
                ev.creatorName = _state.currentUser.name;
            }
            if (ev.participantNames && ev.participantNames[_state.currentUser.id]) {
                ev.participantNames[_state.currentUser.id] = _state.currentUser.name;
            }
        });
        Object.keys(_state.eventChats || {}).forEach(eventId => {
            _state.eventChats[eventId] = (_state.eventChats[eventId] || []).map(msg => {
                if (Number(msg.userId) === Number(_state.currentUser.id)) {
                    return { ...msg, userName: _state.currentUser.name };
                }
                if (oldName && msg.userName === oldName && Number(msg.userId) === Number(_state.currentUser.id)) {
                    return { ...msg, userName: _state.currentUser.name };
                }
                return msg;
            });
        });
    };

    const _loadPublicBaseUrl = async () => {
        try {
            const response = await fetch('/api/public-base-url', { credentials: 'include' });
            const data = await response.json();
            if (response.ok && data.success && data.public_base_url) {
                _state.publicBaseUrl = String(data.public_base_url).replace(/\/+$/, '');
            }
        } catch (_) {
            // fallback para origin atual
        }
    };




    const _getInitialsFromName = (name) => {
        const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
        if (!parts.length) return '--';
        return parts.slice(0, 2).map(p => p[0].toUpperCase()).join('');
    };

    const _renderProfileVisuals = () => {
        const initials = _getInitialsFromName(_state.currentUser.name);
        const photoSrc = String(_state.currentUser.photo || '').trim();
        const userNameEl = document.getElementById('userName');
        const dropdownNameEl = document.getElementById('profileDropdownName');
        const avatarContainers = [
            document.getElementById('profileMiniAvatar'),
            document.getElementById('profileDropdownAvatar'),
            document.getElementById('settingsLargeAvatar')
        ].filter(Boolean);
        const initialsEls = [
            document.getElementById('profileInitials'),
            document.getElementById('profileDropdownInitials'),
            document.getElementById('settingsLargeAvatarInitials')
        ].filter(Boolean);
        const avatarImgs = [
            document.getElementById('profileMiniAvatarImg'),
            document.getElementById('profileDropdownAvatarImg'),
            document.getElementById('settingsLargeAvatarImg')
        ].filter(Boolean);
        const miniAvatarImg = document.getElementById('profileMiniAvatarImg');
        const hasPhoto = photoSrc.length > 0;

        initialsEls.forEach((el) => {
            el.textContent = initials;
            el.style.display = hasPhoto ? 'none' : 'flex';
        });
        avatarContainers.forEach((container) => container.classList.toggle('has-photo', hasPhoto));
        if (userNameEl) userNameEl.textContent = _state.currentUser.name;
        if (dropdownNameEl) dropdownNameEl.textContent = _state.currentUser.name;
        avatarImgs.forEach((img) => {
            if (hasPhoto) {
                img.setAttribute('src', photoSrc);
                img.style.display = 'block';
            } else {
                img.removeAttribute('src');
                img.style.display = 'none';
            }
        });
        if (miniAvatarImg) miniAvatarImg.alt = _state.currentUser.name ? `Foto de ${_state.currentUser.name}` : 'Foto do perfil';
    };

    const _renderProfileInitials = () => {
        _renderProfileVisuals();
    };

    const _renderSettingsValues = () => {
        const fullName = document.getElementById('settingsFullName');
        const bio = document.getElementById('settingsBio');
        const emailNotifications = document.getElementById('settingsEmailNotifications');
        const publicProfile = document.getElementById('settingsPublicProfile');
        const matchReminders = document.getElementById('settingsMatchReminders');
        const darkAtNight = document.getElementById('settingsDarkAtNight');

        if (fullName) fullName.value = _state.currentUser.name;
        if (bio) bio.value = _state.currentUser.bio || '';
        if (emailNotifications) emailNotifications.checked = !!_state.preferences.emailNotifications;
        if (publicProfile) publicProfile.checked = !!_state.preferences.publicProfile;
        if (matchReminders) matchReminders.checked = !!_state.preferences.matchReminders;
        if (darkAtNight) darkAtNight.checked = !!_state.preferences.darkAtNight;
    };

    const _injectSportsIntoProfilePane = () => {
        const fullNameInput = document.getElementById('settingsFullName');
        const bioInput = document.getElementById('settingsBio');
        const favoriteSportInput = document.getElementById('settingsFavoriteSport');
        const sportsPaneBtn = document.querySelector('.s-nav-btn[data-pane="sports"]');
        const sportsPane = document.getElementById('pane-sports');

        if (!fullNameInput || !bioInput) return;

        if (favoriteSportInput) {
            const favoriteWrapper = favoriteSportInput.closest('.settings-field, .form-group, .profile-field, .settings-input-group') || favoriteSportInput.parentElement;
            if (favoriteWrapper) favoriteWrapper.style.display = 'none';
        }

        if (sportsPaneBtn) sportsPaneBtn.style.display = 'none';
        if (sportsPane) sportsPane.style.display = 'none';

        let manager = document.getElementById('profileSportsManager');
        if (!manager) {
            manager = document.createElement('div');
            manager.id = 'profileSportsManager';
            manager.className = 'settings-section-card';
            manager.innerHTML = `
                <div class="settings-section-head">
                    <h4>Esportes</h4>
                    <p>Adicione mais esportes ou o mesmo esporte com outra posição e observação.</p>
                </div>
                <div id="profileSportsContent"></div>
            `;
        }

        const bioWrapper = bioInput.closest('.settings-field, .form-group, .profile-field, .settings-input-group') || bioInput.parentElement;
        const fullNameWrapper = fullNameInput.closest('.settings-field, .form-group, .profile-field, .settings-input-group') || fullNameInput.parentElement;

        if (!manager.parentElement) {
            if (bioWrapper && bioWrapper.parentElement) {
                bioWrapper.parentElement.insertBefore(manager, bioWrapper);
            } else if (fullNameWrapper) {
                fullNameWrapper.insertAdjacentElement('afterend', manager);
            }
        }

        const content = document.getElementById('profileSportsContent');
        if (!content) return;

        const existingList = document.getElementById('sports-list');
        const existingForm = document.getElementById('add-sport-form');
        const existingEmpty = document.getElementById('sportsEmptyState');

        if (existingList && existingList.closest('#profileSportsManager') !== manager) {
            const wrapper = document.createElement('div');
            wrapper.id = 'profileSportsListWrapper';
            wrapper.appendChild(existingList);
            if (existingEmpty) wrapper.appendChild(existingEmpty);
            content.appendChild(wrapper);
        } else if (!existingList) {
            const wrapper = document.createElement('div');
            wrapper.id = 'profileSportsListWrapper';
            wrapper.innerHTML = `
                <ul id="sports-list" class="sports-profile-list"></ul>
                <p id="sportsEmptyState" class="participants-empty-text" style="display:none;">Nenhum esporte cadastrado ainda.</p>
            `;
            content.appendChild(wrapper);
        }

        if (existingForm && existingForm.closest('#profileSportsManager') !== manager) {
            content.appendChild(existingForm);
        } else if (!existingForm) {
            const form = document.createElement('form');
            form.id = 'add-sport-form';
            form.className = 'sports-profile-form';
            form.innerHTML = `
                <div class="sports-profile-grid">
                    <select id="esporte-select">
                        <option value="">Selecione um esporte</option>
                        <option value="Futebol">Futebol</option>
                        <option value="Volei">Vôlei</option>
                        <option value="Basquete">Basquete</option>
                        <option value="Tenis">Tênis</option>
                        <option value="Corrida">Corrida</option>
                        <option value="Outro">Outro</option>
                    </select>
                    <input type="text" id="esporte-custom" placeholder="Digite o esporte" style="display:none;">
                    <select id="posicao-select" style="display:none;"></select>
                    <input type="text" id="posicao-custom" placeholder="Digite a posição" style="display:none;">
                </div>
                <textarea id="observacao" rows="3" placeholder="Observação opcional"></textarea>
                <button type="submit" id="addSportBtn" class="btn-modal-submit">Adicionar esporte</button>
            `;
            content.appendChild(form);
        }
    };

    const _getInviteCandidates = () => Object.values(_players).filter(player => Number(player.id) !== Number(_state.currentUser.id));

    const _invitePlayerToEvent = (playerId) => {
        const myEvents = _state.events.filter(ev => Number(ev.creatorId) === Number(_state.currentUser.id));
        if (!myEvents.length) {
            _showToast('Crie um evento antes de convidar jogadores.');
            return;
        }
        const optionsText = myEvents.map(ev => `${ev.id} - ${ev.nome}`).join('\n');
        const pickedId = window.prompt(`Escolha o ID do evento para convidar:\n${optionsText}`, String(myEvents[0].id));
        if (!pickedId) return;
        const targetEvent = myEvents.find(ev => Number(ev.id) === Number(pickedId));
        if (!targetEvent) {
            _showToast('Evento não encontrado para o convite.');
            return;
        }
        targetEvent.invitedPlayers = [...new Set([...(targetEvent.invitedPlayers || []), Number(playerId)])];
        _syncStorage();
        _showToast('Jogador convidado para o evento.');
    };

    const _injectInviteSectionIntoProfilePane = () => {
        const profilePane = document.getElementById('pane-profile');
        if (!profilePane) return;
        let section = document.getElementById('profileInviteSection');
        if (!section) {
            section = document.createElement('div');
            section.id = 'profileInviteSection';
            section.className = 'settings-section-card';
            section.innerHTML = `
                <div class="settings-section-head">
                    <h4>Adicionar jogador e convidar</h4>
                    <p>Convide jogadores para eventos criados por você.</p>
                </div>
                <div id="invitePlayersList" class="invite-players-list"></div>
            `;
            profilePane.appendChild(section);
        }
        const list = document.getElementById('invitePlayersList');
        if (!list) return;
        list.innerHTML = _getInviteCandidates().map(player => `
            <div class="invite-player-card">
                <div>
                    <strong>${player.nome}</strong>
                    <span>${player.posicao} • ${player.bairro}, ${player.cidade}</span>
                </div>
                <button type="button" class="btn-card-secondary-outline" onclick="engine.logic.invitePlayerToEvent(${player.id})">Convidar</button>
            </div>
        `).join('');
    };

    const _applyRuntimeLayoutFixes = () => {
        if (!document.getElementById('engineRuntimeStyles')) {
            const style = document.createElement('style');
            style.id = 'engineRuntimeStyles';
            style.textContent = `
                #sidebar.collapsed { width: 84px !important; }
                #sidebar.collapsed #sidebarLogo { justify-content: center; align-items: center; padding: 12px 0; }
                #sidebar.collapsed .nav-link-item { justify-content: center; padding-left: 0; padding-right: 0; }
                #profileSportsManager, #profileInviteSection { margin: 16px 0; padding: 18px; border-radius: 18px; background: rgba(255,255,255,0.04); }
                .profile-friends-block { padding: 12px 0; border-bottom: 1px solid rgba(255,255,255,0.08); margin-bottom: 8px; }
                .profile-friends-title { font-size: 12px; text-transform: uppercase; opacity: 0.75; margin: 0 0 8px; }
                .friend-req-row { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin-bottom: 8px; font-size: 13px; }
                .friend-req-title { font-size: 11px; opacity: 0.7; margin: 8px 0 4px; }
                .friend-chip { display: inline-block; padding: 6px 10px; border-radius: 10px; background: rgba(255,255,255,0.08); margin: 4px 4px 0 0; cursor: pointer; font-size: 13px; }
                .profile-invite-site-users { display: grid; gap: 8px; margin-top: 10px; }
                .profile-invite-site-users select { padding: 8px; border-radius: 10px; border: 1px solid rgba(255,255,255,0.12); background: rgba(0,0,0,0.2); color: inherit; }
                .sports-profile-list, .invite-players-list { display: grid; gap: 12px; margin: 14px 0; padding: 0; list-style: none; }
                .sports-profile-item, .invite-player-card { display: flex; justify-content: space-between; align-items: center; gap: 12px; padding: 14px; border-radius: 14px; background: rgba(255,255,255,0.05); flex-wrap: wrap; }
                .sports-profile-item-main, .invite-player-card div { display: grid; gap: 4px; }
                .sports-profile-note { width: 100%; margin: 0; opacity: 0.8; }
                .sports-profile-form { display: grid; gap: 12px; }
                .sports-profile-grid { display: grid; gap: 12px; grid-template-columns: repeat(2, minmax(0, 1fr)); }
                .player-summary-stats { display: grid; gap: 8px; margin-top: 12px; }
                .player-review-form { display: grid; gap: 10px; margin-top: 12px; }
                @media (max-width: 1024px) {
                    .sports-profile-grid { grid-template-columns: 1fr; }
                }
                @media (max-width: 768px) {
                    #sidebar.collapsed { width: 72px !important; }
                    .sports-profile-item, .invite-player-card { align-items: flex-start; }
                }
                @media (min-width: 1600px) {
                    body { font-size: 18px; }
                    .event-big-card, .court-card { min-height: 100%; }
                }
            `;
            document.head.appendChild(style);
        }

        const settingsNavLink = document.querySelector('.nav-link-item[data-view="settings"]');
        if (settingsNavLink) settingsNavLink.style.display = '';
    };

    const _storageKey = (name, scope = 'user') => {
        if (scope === 'global') return `bs_v12_global_${name}`;
        const userId = Number(_state.currentUser.id) || 0;
        return `bs_v12_user_${userId}_${name}`;
    };

    const _readStorage = (name, fallback, scope = 'user') => {
        try {
            const raw = localStorage.getItem(_storageKey(name, scope));
            return raw ? JSON.parse(raw) : fallback;
        } catch (_) {
            return fallback;
        }
    };

    const _writeStorage = (name, value, scope = 'user') => {
        localStorage.setItem(_storageKey(name, scope), JSON.stringify(value));
    };

    const _openSettingsPane = (pane) => {
        document.querySelectorAll('.s-nav-btn').forEach(btn => {
            btn.classList.toggle('active', btn.getAttribute('data-pane') === pane);
        });
        document.querySelectorAll('.settings-pane').forEach(section => {
            section.classList.toggle('active', section.id === `pane-${pane}`);
        });
        if (pane === 'sports' || pane === 'profile') {
            _loadUserSports();
        }
    };

    const _loadUserSports = async () => {
        try {
            const response = await fetch('/api/user-sports', { credentials: 'include' });
            const data = await response.json();
            if (data.success) {
                _renderUserSports(data.sports);
            }
        } catch (e) {
            console.error('Erro ao carregar esportes:', e);
        }
    };

    const _renderUserSports = (sports) => {
        const list = document.getElementById('sports-list');
        const emptyState = document.getElementById('sportsEmptyState');
        if (!list) return;
        list.innerHTML = '';
        if (!sports || !sports.length) {
            if (emptyState) emptyState.style.display = 'block';
            return;
        }
        if (emptyState) emptyState.style.display = 'none';
        sports.forEach(sport => {
            const li = document.createElement('li');
            li.className = 'sports-profile-item';
            li.innerHTML = `
                <div class="sports-profile-item-main">
                    <strong>${sport.esporte}</strong>
                    <span>${sport.posicao || 'Sem posição definida'}</span>
                </div>
                ${sport.observacao ? `<p class="sports-profile-note">Obs: ${sport.observacao}</p>` : ''}
                <button type="button" class="btn-card-secondary-outline" onclick="engine.ui.deleteSport(${sport.id})">Remover</button>
            `;
            list.appendChild(li);
        });
    };

    const _setupSportsForm = () => {
        const esporteSelect = document.getElementById('esporte-select');
        const esporteCustom = document.getElementById('esporte-custom');
        const posicaoSelect = document.getElementById('posicao-select');
        const posicaoCustom = document.getElementById('posicao-custom');
        if (!esporteSelect) return;
        esporteSelect.addEventListener('change', function() {
            const selected = this.value;
            if (selected === 'Outro') {
                esporteCustom.style.display = 'block';
                esporteCustom.required = true;
                posicaoSelect.style.display = 'none';
                posicaoCustom.style.display = 'block';
                posicaoCustom.required = false;
                posicaoSelect.required = false;
            } else if (selected && _state.sportsPositions[selected]) {
                esporteCustom.style.display = 'none';
                esporteCustom.required = false;
                esporteCustom.value = '';
                posicaoSelect.style.display = 'block';
                posicaoCustom.style.display = 'none';
                posicaoCustom.required = false;
                posicaoCustom.value = '';
                posicaoSelect.required = false;
                _populatePositions(selected);
            } else {
                esporteCustom.style.display = 'none';
                esporteCustom.required = false;
                posicaoSelect.style.display = 'none';
                posicaoCustom.style.display = 'none';
                posicaoSelect.required = false;
                posicaoCustom.required = false;
            }
        });
        const form = document.getElementById('add-sport-form');
        if (form) form.addEventListener('submit', async function(e) {
            e.preventDefault();
            const esporte = esporteSelect.value === 'Outro' ? esporteCustom.value : esporteSelect.value;
            const posicao = posicaoSelect.style.display !== 'none' ? posicaoSelect.value : posicaoCustom.value;
            const observacao = document.getElementById('observacao').value;
            try {
                const response = await fetch('/api/user-sports', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    credentials: 'include',
                    body: JSON.stringify({ esporte, posicao, observacao })
                });
                const data = await response.json();
                if (data.success) {
                    _loadUserSports();
                    this.reset();
                    esporteCustom.style.display = 'none';
                    posicaoSelect.style.display = 'none';
                    posicaoCustom.style.display = 'none';
                    _showToast('Esporte adicionado!');
                } else {
                    _showToast(data.message);
                }
            } catch (e) {
                _showToast('Erro ao adicionar esporte.');
            }
        });
    };

    const _populatePositions = (esporte) => {
        const posicaoSelect = document.getElementById('posicao-select');
        posicaoSelect.innerHTML = '<option value="">Selecione uma posição</option>';
        _state.sportsPositions[esporte].forEach(pos => {
            const option = document.createElement('option');
            option.value = pos;
            option.textContent = pos;
            posicaoSelect.appendChild(option);
        });
    };

    const _deleteSport = async (id) => {
        if (confirm('Remover este esporte?')) {
            try {
                const response = await fetch(`/api/user-sports/${id}`, { method: 'DELETE', credentials: 'include' });
                const data = await response.json();
                if (data.success) {
                    _loadUserSports();
                    _showToast('Esporte removido!');
                } else {
                    _showToast(data.message);
                }
            } catch (e) {
                _showToast('Erro ao remover esporte.');
            }
        }
    };

    const _loadCurrentUserFromAPI = async () => {
        if (!_state.auth.isLoggedIn) return;
        try {
            const response = await fetch('/me', { credentials: 'include' });
            const data = await response.json();
            if (response.ok && data.success) {
                const oldName = _state.currentUser.name;
                _state.currentUser.id = Number(data.id) || _state.currentUser.id;
                _state.currentUser.name = data.nome || _state.currentUser.name;
                if (data.foto_perfil) {
                    _state.currentUser.photo = String(data.foto_perfil);
                }
                if (typeof data.reputacao_partidas === 'number') _state.currentUser.reputation = data.reputacao_partidas;
                if (typeof data.gols === 'number') _state.currentUser.gols = data.gols;
                if (typeof data.partidas_ganhas === 'number') _state.currentUser.partidasGanhas = data.partidas_ganhas;
                _loadUserScopedState();
                _refreshCurrentUserNameEverywhere(oldName);
                _state.userOwnedEvents = [...new Set([
                    ..._state.userOwnedEvents,
                    ..._state.events.filter(ev => Number(ev.creatorId) === Number(_state.currentUser.id)).map(ev => ev.id)
                ])];
                _state.userOwnedCourts = [...new Set([
                    ..._state.userOwnedCourts,
                    ..._courts.filter(court => Number(court.ownerId) === Number(_state.currentUser.id)).map(court => court.id)
                ])];
                _syncStorage();
                _renderProfileVisuals();
                _renderSettingsValues();
                _renderAll();
            }
        } catch (_) {
            // fallback local
        }
    };

    const _loadPersistentData = () => {
        _state.eventChats = _readStorage('event_chats', {}, 'global');
        _state.courtBookings = _readStorage('court_bookings', {}, 'global');
        _state.playerFeedback = _readStorage('player_feedback', {}, 'global');
        _state.playerReports = _readStorage('player_reports', {}, 'global');
        _loadUserScopedState();
        let sourceEvents = _readStorage('events', _initialSeed, 'global');
        if (!Array.isArray(sourceEvents) || sourceEvents.length === 0) {
            sourceEvents = _initialSeed;
        }
        const inferCourtId = (ev) => {
            if (ev.quadra_id) return ev.quadra_id;
            const match = _courts.find(c =>
                (c.rua || '').toLowerCase() === (ev.rua || '').toLowerCase() &&
                (c.cidade || '').toLowerCase() === (ev.cidade || '').toLowerCase()
            );
            return match ? match.id : null;
        };
        _state.events = sourceEvents.map(ev => {
            let dataEvento = ev.data_evento || ev.data || '';
            if (/^2025-/.test(dataEvento)) dataEvento = dataEvento.replace(/^2025-/, '2026-');
            return ({
                ...ev,
                creatorId: ev.creatorId || 1,
                creatorName: ev.creatorName || 'Felipe Silva',
                data_evento: dataEvento,
                data: dataEvento,
                quadra_id: inferCourtId(ev),
                players: ev.players || ev.participantes || [Number(ev.creatorId || 1)],
                spectators: ev.spectators || [],
                participantes: ev.participantes || ev.players || [Number(ev.creatorId || 1)],
                participantNames: ev.participantNames || Object.fromEntries((ev.participantes || []).map(pid => [pid, (_players[pid] && _players[pid].nome) || `Jogador ${pid}`]))
            });
        }).map(ev => {
            _recalculateEventOccupancy(ev);
            return ev;
        });
        _state.userOwnedEvents = [...new Set([
            ..._state.userOwnedEvents,
            ..._state.events.filter(ev => Number(ev.creatorId) === Number(_state.currentUser.id)).map(ev => ev.id)
        ])];
        _state.userOwnedCourts = [...new Set([
            ..._state.userOwnedCourts,
            ..._courts.filter(court => Number(court.ownerId) === Number(_state.currentUser.id)).map(court => court.id)
        ])];
    };

    const _syncStorage = () => {
        _state.events.forEach(_recalculateEventOccupancy);
        _writeStorage('events', _state.events, 'global');
        _writeStorage('subs', _state.userSubscriptions, 'user');
        _writeStorage('owned', _state.userOwnedEvents, 'user');
        _writeStorage('owned_courts', _state.userOwnedCourts, 'user');
        _writeStorage('history', _state.userHistory, 'user');
        _writeStorage('court_bookings', _state.courtBookings, 'global');
        _writeStorage('stats', _state.userStats, 'user');
        _writeStorage('event_chats', _state.eventChats, 'global');
        _writeStorage('player_feedback', _state.playerFeedback, 'global');
        _writeStorage('player_reports', _state.playerReports, 'global');
        localStorage.setItem(_storageKey('profile_photo'), _state.currentUser.photo || '');
        localStorage.setItem(_storageKey('profile_bio'), _state.currentUser.bio || '');
        localStorage.setItem(_storageKey('profile_sport'), _state.currentUser.favoriteSport || 'Futebol');
        _writeStorage('preferences', _state.preferences, 'user');
    };



    const _isPrivateCourtType = (tipo) => (tipo || '').toLowerCase().includes('alugada');

    const _formatTime = (str) => {
        if (!str) return '-';
        const s = String(str);
        if (s.includes(' ')) {
            const tail = s.trim().split(/\s+/).pop();
            return tail.slice(0, 5);
        }
        return s.slice(0, 5);
    };

    const _toMinutes = (hhmm) => {
        const [h,m] = String(hhmm || '00:00').split(':').map(Number);
        return (h||0)*60+(m||0);
    };

    const _dayToken = (dateStr) => ['dom','seg','ter','qua','qui','sex','sab'][new Date(dateStr + 'T12:00:00').getDay()];

    const _nextDateFromDayToken = (dayToken) => {
        const map = { dom:0, seg:1, ter:2, qua:3, qui:4, sex:5, sab:6 };
        const target = map[dayToken];
        const now = new Date();
        const today = now.getDay();
        const delta = (target - today + 7) % 7;
        const d = new Date(now);
        d.setDate(now.getDate() + delta);
        const y = d.getFullYear();
        const m = String(d.getMonth()+1).padStart(2,'0');
        const day = String(d.getDate()).padStart(2,'0');
        return `${y}-${m}-${day}`;
    };

    const _isInEvent = (ev) => (ev.players||[]).includes(_state.currentUser.id) || (ev.spectators||[]).includes(_state.currentUser.id) || ev.creatorId===_state.currentUser.id;

    const _toggleRole = (eventId, userId, toRole) => {
        const ev = _state.events.find(e => e.id === eventId);
        if (!ev || ev.creatorId !== _state.currentUser.id || userId===ev.creatorId) return;
        ev.players = (ev.players||[]).filter(i => i!==userId);
        ev.spectators = (ev.spectators||[]).filter(i => i!==userId);
        (toRole==='player' ? ev.players : ev.spectators).push(userId);
        _recalculateEventOccupancy(ev);
        _syncStorage();
        _renderAll();
        _openEventDetails(eventId);
    };

    const _removeFromEvent = (eventId, userId) => {
        const ev = _state.events.find(e => e.id===eventId);
        if (!ev || ev.creatorId !== _state.currentUser.id || userId===ev.creatorId) return;
        ev.players = (ev.players||[]).filter(i => i!==userId);
        ev.spectators = (ev.spectators||[]).filter(i => i!==userId);
        _recalculateEventOccupancy(ev);
        _syncStorage();
        _renderAll();
        _openEventDetails(eventId);
    };

    const _shareEvent = async (eventId) => {
        const ev = _state.events.find(e => e.id===eventId);
        if (!ev) return;
        const txt = `${ev.nome} em ${ev.cidade} dia ${_formatDateBr(ev.data_evento||ev.data)} às ${_formatTime(ev.horario_inicio)}`;
        try {
            if (navigator.share) await navigator.share({title: ev.nome, text: txt});
            else await navigator.clipboard.writeText(txt);
            _showToast('Evento compartilhado!');
        } catch (_) { _showToast('Não foi possível compartilhar agora.'); }
    };

    const _buildInviteUrl = (eventId) => {
        const baseUrl = _state.publicBaseUrl || window.location.origin;
        return `${baseUrl}/evento/${eventId}`;
    };

    const _handleInviteFromUrl = () => {
        const params = new URLSearchParams(window.location.search);
        const inviteEventId = Number(_state.selectedEventId || params.get('id_evento') || params.get('invite_event'));
        if (!inviteEventId) return;
        _state.selectedEventId = inviteEventId;
        const ev = _state.events.find(e => Number(e.id) === inviteEventId);
        if (!ev) {
            console.error('Evento do convite não encontrado na lista atual.', { inviteEventId, eventos: _state.events });
            _showToast('Evento do convite não encontrado.');
            return;
        }
        _openEventDetails(inviteEventId);
        if (_state.auth.isGuestFlow && !_state.auth.guestPresenceConfirmed) {
            _openGuestPresenceModal();
        }
        _showToast(`Convite aberto: ${ev.nome}`);
    };

    const _openInviteQrModal = (eventId) => {
        const ev = _state.events.find(e => e.id === eventId);
        if (!ev) return;
        const inviteUrl = _buildInviteUrl(eventId);
        const qrImage = document.getElementById('inviteQrImage');
        const linkInput = document.getElementById('inviteQrLink');
        const eventName = document.getElementById('inviteQrEventName');
        const copyBtn = document.getElementById('copyInviteLinkBtn');
        const shareBtn = document.getElementById('shareInviteBtn');

        if (qrImage) {
            qrImage.src = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(inviteUrl)}`;
        }
        if (linkInput) linkInput.value = inviteUrl;
        if (eventName) eventName.textContent = ev.nome || 'Evento';

        if (copyBtn) {
            copyBtn.onclick = async () => {
                try {
                    await navigator.clipboard.writeText(inviteUrl);
                    _showToast('Link de convite copiado!');
                } catch (_) {
                    _showToast('Não foi possível copiar o link.');
                }
            };
        }

        if (shareBtn) {
            shareBtn.onclick = async () => {
                const text = `Convite para o evento ${ev.nome}: ${inviteUrl}`;
                try {
                    if (navigator.share) {
                        await navigator.share({ title: `Convite: ${ev.nome}`, text, url: inviteUrl });
                    } else {
                        await navigator.clipboard.writeText(inviteUrl);
                    }
                    _showToast('Convite pronto para compartilhar!');
                } catch (_) {
                    _showToast('Não foi possível compartilhar agora.');
                }
            };
        }

        _openModal('inviteQrModal');
    };

    const _renderPrivateSlotsForCourt = (court) => {
        const grid = document.getElementById('privateCourtSlotsGrid');
        if (!grid) return;
        if (!court || !_isPrivateCourtType(court.tipo)) { grid.innerHTML=''; return; }

        const weekOrder = ['seg','ter','qua','qui','sex','sab','dom'];
        const fullWeek = court.weekSchedule && court.weekSchedule.length
            ? court.weekSchedule
            : weekOrder.map(d => ({ dia: d, inicio: court.disponibilidade?.inicio || '08:00', fim: court.disponibilidade?.fim || '18:00' }));

        let html = '';
        fullWeek.forEach(cfg => {
            const day = cfg.dia;
            const start = _toMinutes(cfg.inicio || '00:00');
            const end = _toMinutes(cfg.fim || '00:00');
            html += `<div class="slot-day-group"><h5>${day.toUpperCase()}</h5><div class="private-slots-grid">`;
            if (cfg.fechado || !cfg.inicio || !cfg.fim || end <= start) {
                html += '<p class="participants-empty-text">Fechada</p>';
            } else {
                const key = `${court.id}_${day}`;
                const bookings = _state.courtBookings[key] || [];
                for (let m = start; m < end; m += 30) {
                    const hh = String(Math.floor(m / 60)).padStart(2, '0');
                    const mm = String(m % 60).padStart(2, '0');
                    const label = `${hh}:${mm}`;
                    const booked = bookings.find(b => b.slot === label);
                    let cls = 'slot-green';
                    if (booked) cls = booked.userId === _state.currentUser.id ? 'slot-blue' : 'slot-red';
                    html += `<button type="button" class="private-slot ${cls}" data-day="${day}" data-slot="${label}" ${booked && booked.userId!==_state.currentUser.id ? 'disabled' : ''}>${label}</button>`;
                }
            }
            html += '</div></div>';
        });

        grid.innerHTML = html;
        grid.querySelectorAll('.private-slot.slot-green,.private-slot.slot-blue').forEach(btn => btn.onclick = () => { btn.classList.toggle('slot-blue'); _updateEventFromCourtPrice(); });
        _updateEventFromCourtPrice();
    };

    // --------------------
    // RENDERIZAÇÃO
    // --------------------

    const renderEvents = (container, events, { emptyHtml = '', mapper = null } = {}) => {
        if (!container) return;
        container.innerHTML = '';
        if (!Array.isArray(events) || !events.length) {
            if (emptyHtml) container.innerHTML = emptyHtml;
            return;
        }
        const html = events.map((event) => (mapper ? mapper(event) : '')).join('');
        container.insertAdjacentHTML('beforeend', html);
    };

    const _renderDashboard = () => {
        const subContainer = document.getElementById('activeSubscriptionsList');
        const mySubs = _state.events.filter(e => _state.userSubscriptions.includes(e.id));

        renderEvents(subContainer, mySubs, {
            emptyHtml: `<div class="empty-placeholder">Nenhuma partida marcada.</div>`,
            mapper: (ev) => _createCardHTML(ev, true)
        });

        _renderNearbyCourts();
        _renderNearbyEvents();
        _renderSportsSections();
    };

    const _renderStats = () => {
        const summary = _getUserProfileSummary(Number(_state.currentUser.id));
        const apiReputation = Number(_state.currentUser.reputation);
        const fallbackReputation = Number(summary.reputation);
        const currentReputation = Number.isFinite(apiReputation)
            ? apiReputation
            : Number.isFinite(fallbackReputation)
                ? fallbackReputation
                : 5;
        _state.currentUser.reputation = currentReputation;
        _state.userStats.partidas = summary.partidas;
        _state.userStats.total = summary.partidas;
        _state.userStats.vitorias = summary.partidasGanhas;
        _state.userStats.gols = Number.isFinite(Number(_state.currentUser.gols)) ? Number(_state.currentUser.gols) : _state.userStats.gols;
        const partidasEl = document.querySelector('.stat-item .stat-v');
        const reputacaoEl = document.querySelectorAll('.stat-item .stat-v')[1];
        if (partidasEl) partidasEl.textContent = String(summary.partidas ?? 0);
        if (reputacaoEl) reputacaoEl.textContent = currentReputation.toFixed(1);

        const dashRepEl = document.getElementById('dashRepPartidas');
        if (dashRepEl) dashRepEl.textContent = currentReputation.toFixed(1);

        const totalJogosEl = document.getElementById('historyTotalGames');
        const golsEl = document.getElementById('historyGoals');
        const reputacaoChipEl = document.getElementById('historyReputationChip');
        if (totalJogosEl) totalJogosEl.textContent = `Total: ${_state.userStats.total || 0} Jogos`;
        if (golsEl) golsEl.textContent = `Gols: ${_state.userStats.gols || 0}`;
        if (reputacaoChipEl) {
            reputacaoChipEl.innerHTML = `Reputacao: <span class="rating-value">${currentReputation.toFixed(1)}</span> ${_renderStarRating(currentReputation, 'Reputacao do seu historico')}`;
        }
    };

    const _renderNearbyCourts = () => {
        const container = document.getElementById('nearbyCourtsList');
        if (!container) return;

        let list = [..._courts];

        if (_state.userCity) {
            const cityNorm = _state.userCity.toLowerCase();
            list.sort((a, b) => {
                const aSame = (a.cidade || '').toLowerCase() === cityNorm;
                const bSame = (b.cidade || '').toLowerCase() === cityNorm;
                if (aSame && !bSame) return -1;
                if (!aSame && bSame) return 1;
                return 0;
            });
        }

        const top = list.slice(0, 5);
        container.innerHTML = top.map(c => _createCourtCardHTML(c)).join('');
    };

    const _renderNearbyEvents = () => {
        const container = document.getElementById('nearbyEventsList');
        if (!container) return;

        let list = [..._state.events];

        if (_state.userCity) {
            const cityNorm = _state.userCity.toLowerCase();
            list.sort((a, b) => {
                const aSame = (a.cidade || '').toLowerCase() === cityNorm;
                const bSame = (b.cidade || '').toLowerCase() === cityNorm;
                if (aSame && !bSame) return -1;
                if (!aSame && bSame) return 1;
                return 0;
            });
        }

        const top = list.slice(0, 5);
        renderEvents(container, top, {
            mapper: (ev) => _createCardHTML(ev, _state.userSubscriptions.includes(ev.id))
        });
    };

    const _renderSportsSections = () => {
        const tabFut = document.getElementById('sportTabFutebol');
        const tabVol = document.getElementById('sportTabVolei');
        const tabBas = document.getElementById('sportTabBasquete');
        if (!tabFut || !tabVol || !tabBas) return;

        const bySport = (sport) =>
            _state.events.filter(e => (e.esporte || '').toLowerCase() === sport.toLowerCase()).slice(0, 5);

        renderEvents(tabFut, bySport('Futebol'), {
            mapper: (ev) => _createCardHTML(ev, _state.userSubscriptions.includes(ev.id))
        });
        renderEvents(tabVol, bySport('Volei'), {
            mapper: (ev) => _createCardHTML(ev, _state.userSubscriptions.includes(ev.id))
        });
        renderEvents(tabBas, bySport('Basquete'), {
            mapper: (ev) => _createCardHTML(ev, _state.userSubscriptions.includes(ev.id))
        });
    };

    const _renderCourts = () => {
        const grids = [
            document.getElementById('quadrasGrid'),
            document.getElementById('courtsListContainer')
        ].filter(Boolean);

        if (!grids.length) return;

        let base = [..._courts];

        const f = _state.courtsFilters;
        if (f.cidade) {
            const c = f.cidade.toLowerCase();
            base = base.filter(q => (q.cidade || '').toLowerCase().includes(c));
        }
        if (f.bairro) {
            const b = f.bairro.toLowerCase();
            base = base.filter(q => (q.bairro || '').toLowerCase().includes(b));
        }
        if (f.esporte) {
            const e = f.esporte.toLowerCase();
            base = base.filter(q => (q.esporte || '').toLowerCase().includes(e));
        }
        if (f.tipo) {
            const t = f.tipo.toLowerCase();
            base = base.filter(q => (q.tipo || '').toLowerCase() === t);
        }
        if (typeof f.capacidadeMin === 'number' && !Number.isNaN(f.capacidadeMin)) {
            base = base.filter(q => (Number(q.capacidade) || 0) >= f.capacidadeMin);
        }

        const annotated = base.map((court, index) => ({ court, index }));

        let ordered = annotated;

        if (_state.userCity) {
            const cityNorm = _state.userCity.toLowerCase();

            ordered = [...annotated].sort((a, b) => {
                const aSame = (a.court.cidade || '').toLowerCase() === cityNorm;
                const bSame = (b.court.cidade || '').toLowerCase() === cityNorm;

                if (aSame && !bSame) return -1;
                if (!aSame && bSame) return 1;

                return a.index - b.index;
            });
        }

        const html = ordered.map(({ court }) => _createCourtCardHTML(court)).join('');
        grids.forEach(g => g.innerHTML = html);
    };

    const _createCourtCardHTML = (c) => {
        const capacidade = Number.isFinite(Number(c.capacidade)) ? Number(c.capacidade) : (c.capacidade ?? '');
        const ativos = (_state.events || []).filter(ev => Number(ev.quadra_id || 0) === Number(c.id)).length;
        return `
        <div class="court-card">
            <div class="card-top-info">
                <span class="card-sport-tag">${c.esporte || 'Quadra'}</span>
            </div>
            <h3 class="card-h3">${c.nome || 'Quadra sem nome'}</h3>
            <div class="card-details-grid">
                <div class="detail-row"><i class="fas fa-map-marker-alt"></i> ${c.bairro || ''}${c.cidade ? `, ${c.cidade}` : ''}</div>
                <div class="detail-row"><i class="fas fa-users"></i> Capacidade: ${capacidade || '-'}</div>
                <div class="detail-row"><i class="fas fa-calendar-check"></i> Eventos ativos: ${ativos}</div>
                ${c.rua ? `<div class="detail-row"><i class="fas fa-road"></i> ${c.rua}</div>` : ''}
                ${c.cep ? `<div class="detail-row"><i class="fas fa-mail-bulk"></i> ${c.cep}</div>` : ''}
                ${c.preco_30min ? `<div class="detail-row"><i class="fas fa-coins"></i> R$ ${Number(c.preco_30min).toFixed(2)} / 30 min</div>` : ''}
            </div>
            <div class="card-actions-row" style="margin-top: 18px; display: flex; gap: 12px;">
                <button class="btn-card-secondary-outline"
                        onclick="engine.logic.abrirLocalizacao('${c.rua || ""}', '${c.numero || ""}', '${c.bairro || ""}', '${c.cidade || ""}', '${c.estado || ""}')"
                        style="flex: 1; background: transparent !important; border: 2px solid #28a745 !important; color: #28a745 !important; cursor: pointer; border-radius: 12px; font-weight: bold; height: 45px;">
                    <i class="fas fa-map-marked-alt"></i> Mapa
                </button>
                <button class="btn-card-secondary-outline"
                        onclick="event.stopPropagation(); engine.logic.openCreateEventFromCourt(${c.id});"
                        style="flex: 1; background: transparent !important; border: 2px solid var(--primary) !important; color: var(--primary) !important; cursor: pointer; border-radius: 12px; font-weight: bold; height: 45px;">
                    <i class="fas fa-plus-circle"></i> Criar Evento
                </button>
                <button class="btn-card-secondary-outline"
                        onclick="event.stopPropagation(); engine.logic.openCourtDetails(${c.id});"
                        style="flex: 1; background: transparent !important; border: 2px solid #3b82f6 !important; color: #3b82f6 !important; cursor: pointer; border-radius: 12px; font-weight: bold; height: 45px;">
                    <i class="fas fa-info-circle"></i> Saiba mais
                </button>
            </div>
        </div>`;
    };

    const _createCardHTML = (ev, isSubscribed, isHistory = false, isOwner = false) => {
        if (!ev || typeof ev !== "object") return "";
        try {
            _recalculateEventOccupancy(ev);
        } catch (_) {}
        const max = Number(ev.max) || 10;
        const ocupadas = Number(ev.ocupadas) || 0;
        const vagas = Math.max(0, max - ocupadas);
        const valorUnitario = (ev.valor > 0 && max > 0) ? (Number(ev.valor) / max).toFixed(2) : "0.00";

        return `
        <div class="event-big-card event-big-card--compact" onclick="engine.logic.openEventDetails(${ev.id})">
            <div class="card-top-info">
                <span class="card-sport-tag">${ev.esporte}</span>
                <div class="card-meta-icons">${isOwner ? '<i class="fas fa-crown orange-glow"></i>' : ''}</div>
            </div>
            <h3 class="card-h3">${ev.nome}</h3>
            <div class="card-details-grid">
                <div class="detail-row"><i class="fas fa-map-marker-alt"></i> ${ev.bairro}, ${ev.cidade}</div>
                <div class="detail-row"><i class="fas fa-users"></i> ${ocupadas}/${max} Atletas</div>
                <div class="detail-row"><i class="fas fa-venus-mars"></i> ${ev.genero}</div>
                <div class="detail-row"><i class="fas fa-tag"></i> R$ ${valorUnitario} /p</div>
                <div class="detail-row"><i class="fas fa-clock"></i> ${_formatTime(ev.horario_inicio)} - ${_formatTime(ev.horario_termino)}</div>
                <div class="detail-row"><i class="fas fa-chair"></i> ${vagas > 0 ? `${vagas} vagas` : 'Lotado'}</div>
            </div>
            <div class="card-actions-row">
                <button class="btn-card-secondary-outline" onclick="event.stopPropagation(); engine.logic.openInviteQrModal(${ev.id});">
                    <i class="fas fa-qrcode"></i> QR Convite
                </button>
            </div>
            <p class="description-text">Toque para ver detalhes, ações e pagamento.</p>
        </div>`;
    };

    const _renderExplore = () => {
        const grid = document.getElementById('exploreEventsGrid');
        if (!grid) return;

        let filtered = [..._state.events];

        const f = _state.exploreFilters;

        if (f.cidade) {
            const c = f.cidade.toLowerCase();
            filtered = filtered.filter(e => (e.cidade || '').toLowerCase().includes(c));
        }
        if (f.esporte) {
            filtered = filtered.filter(e => (e.esporte || '').toLowerCase() === f.esporte.toLowerCase());
        }
        if (f.faixa) {
            filtered = filtered.filter(e => (e.faixa_etaria || e.faixa || '').toLowerCase() === f.faixa.toLowerCase());
        }
        if (f.genero) {
            filtered = filtered.filter(e => (e.genero || '').toLowerCase() === f.genero.toLowerCase());
        }
        if (f.data) {
            filtered = filtered.filter(e => (e.data_evento || e.data || '').startsWith(f.data));
        }
        if (f.buscaLivre) {
            const q = f.buscaLivre.toLowerCase();
            filtered = filtered.filter(e =>
                (e.nome || '').toLowerCase().includes(q) ||
                (e.bairro || '').toLowerCase().includes(q) ||
                (e.descricao || '').toLowerCase().includes(q)
            );
        }

        renderEvents(grid, filtered, {
            mapper: (ev) => _createCardHTML(ev, _state.userSubscriptions.includes(ev.id))
        });
    };

    const _renderHistory = () => {
        const container = document.getElementById('historyDetailedList');
        if (!container) return;
        const list = _state.events.filter(e => _state.userHistory.includes(e.id));
        renderEvents(container, list, {
            mapper: (ev) => _createCardHTML(ev, false, true)
        });
    };

    const _renderOwned = () => {
        const container = document.getElementById('ownedEventsList');
        if (!container) return;
        const list = _state.events.filter(e => _state.userOwnedEvents.includes(e.id) || Number(e.creatorId) === Number(_state.currentUser.id));
        renderEvents(container, list, {
            emptyHtml: `<div class="empty-placeholder">Você ainda não criou nenhum evento.</div>`,
            mapper: (ev) => _createCardHTML(ev, false, false, true)
        });
    };

    const _renderOwnedCourts = () => {
        const container = document.getElementById('ownedCourtsList');
        if (!container) return;
        const list = _courts.filter(c => _state.userOwnedCourts.includes(c.id) || Number(c.ownerId) === Number(_state.currentUser.id));
        container.innerHTML = list.length
            ? list.map(court => _createCourtCardHTML(court)).join('')
            : `<div class="empty-placeholder">Você ainda não cadastrou nenhuma quadra.</div>`;
    };

    const _renderAll = () => {
        _state.events.forEach(_recalculateEventOccupancy);
        _renderStats();
        _renderDashboard();
        _renderExplore();
        _renderHistory();
        _renderOwned();
        _renderOwnedCourts();
        _renderCourts();
        _renderStats();
    };

    // --------------------
    // LÓGICA DE NEGÓCIO
    // --------------------
    const _handleSubscription = async (id) => {
        if (!_state.auth.isLoggedIn) {
            if (_state.auth.isGuestFlow && Number(_state.selectedEventId) === Number(id)) {
                _openGuestPresenceModal();
            } else {
                _showToast('Faça login para participar do evento.');
            }
            return;
        }
        const ev = _state.events.find(e => e.id === id);
        if (!ev) return;
        const subIndex = _state.userSubscriptions.indexOf(id);
        if (subIndex > -1) {
            _showToast("Somente o criador pode excluir o evento.");
            return;
        }
        if (_recalculateEventOccupancy(ev) >= ev.max) return;
        try {
            const r = await fetch(`/eventos/${id}/participar`, { method: 'POST', credentials: 'include' });
            const d = await r.json();
            if (!r.ok) { _showToast(d.message || 'Não foi possível entrar.'); return; }
        } catch (_) {
            _showToast('Erro de conexão.');
            return;
        }
        _state.userSubscriptions.push(id);
        ev.players = [...new Set([...(ev.players||[]), _state.currentUser.id])];
        ev.participantNames = ev.participantNames || {};
        ev.participantNames[_state.currentUser.id] = _state.currentUser.name;
        _recalculateEventOccupancy(ev);
        _showToast('Inscrição confirmada!');
        await _loadServerData();
        _syncStorage();
        _renderAll();
        _openEventDetails(id);
    };

    const _leaveEvent = async (id) => {
        if (!_state.auth.isLoggedIn) {
            _showToast('Faça login para alterar sua presença no evento.');
            return;
        }
        const ev = _state.events.find(e => e.id === id);
        if (!ev) return;
        if (Number(ev.creatorId) === Number(_state.currentUser.id)) {
            _showToast('O criador pode excluir o evento, mas não sair dele.');
            return;
        }
        try {
            const r = await fetch(`/eventos/${id}/participar`, { method: 'DELETE', credentials: 'include' });
            const d = await r.json();
            if (!r.ok) { _showToast(d.message || 'Não foi possível sair.'); return; }
        } catch (_) {
            _showToast('Erro de conexão.');
            return;
        }
        _state.userSubscriptions = _state.userSubscriptions.filter(subId => subId !== id);
        ev.players = (ev.players || []).filter(uid => Number(uid) !== Number(_state.currentUser.id));
        ev.spectators = (ev.spectators || []).filter(uid => Number(uid) !== Number(_state.currentUser.id));
        if (ev.participantNames) delete ev.participantNames[_state.currentUser.id];
        _recalculateEventOccupancy(ev);
        await _loadServerData();
        _syncStorage();
        _renderAll();
        _openEventDetails(id);
        _showToast('Você saiu do evento.');
    };

    const _createNewEvent = (formData) => {
        const newEv = {
            id: Date.now(),
            ...formData,
            creatorId: _state.currentUser.id,
            creatorName: _state.currentUser.name,
            participants: [_state.currentUser.id],
            participantNames: { [_state.currentUser.id]: _state.currentUser.name },
            players: [_state.currentUser.id],
            spectators: [],
            ocupadas: 1
        };
        _state.events.unshift(newEv);
        _state.userOwnedEvents.push(newEv.id);
        _state.userSubscriptions.push(newEv.id);
        _syncStorage();
        _renderAll();
        _closeModal('createModal');
        _showToast("Evento publicado!");
    };

    const _deleteEvent = async (id) => {
        if (!confirm("Excluir evento?")) return;
        try {
            const r = await fetch(`/eventos/${id}`, { method: 'DELETE', credentials: 'include' });
            const d = await r.json();
            if (!r.ok) { _showToast(d.message || 'Não foi possível excluir.'); return; }
        } catch (_) {
            _showToast('Erro de conexão.');
            return;
        }
        _state.events = _state.events.filter(e => e.id !== id);
        _state.userOwnedEvents = _state.userOwnedEvents.filter(oid => oid !== id);
        _state.userSubscriptions = _state.userSubscriptions.filter(sid => sid !== id);
        await _loadServerData();
        _syncStorage();
        _renderAll();
        _closeModal('infoModal');
        _showToast("Evento excluído.");
    };

    const _formatDateBr = (str) => {
        if (!str) return '-';
        const d = new Date(str + 'T12:00:00');
        if (isNaN(d.getTime())) return str;
        return d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' });
    };

    const _getFrequentCourtsText = (userId) => {
        const counts = {};
        (_state.events || []).forEach(ev => {
            const involved = [...new Set([...(ev.players || []), ...(ev.spectators || [])])].includes(userId);
            if (involved && ev.quadra_id) counts[ev.quadra_id] = (counts[ev.quadra_id] || 0) + 1;
        });
        const sortedIds = Object.keys(counts).sort((a, b) => counts[b] - counts[a]).slice(0, 3);
        if (!sortedIds.length) return 'Sem quadras frequentes ainda';
        return sortedIds.map(id => (_courts.find(c => Number(c.id) === Number(id)) || {}).nome || `Quadra ${id}`).join(', ');
    };

    const reputationRepo = {
        getProfile: async (userId) => {
            const response = await fetch(`/api/perfil/${Number(userId)}`, { credentials: 'include' });
            const payload = await response.json().catch(() => ({}));
            return { ok: response.ok, status: response.status, ...payload };
        },
        reportPlayer: async (userId, eventId) => {
            const response = await fetch(`/api/jogadores/${Number(userId)}/report`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ event_id: Number(eventId) })
            });
            const payload = await response.json().catch(() => ({}));
            return { ok: response.ok, status: response.status, ...payload };
        }
    };

    const _getPlayerGames = (userId) => {
        const targetId = Number(userId);
        if (!Number.isFinite(targetId) || targetId <= 0) return [];

        return (_state.events || [])
            .filter((ev) => {
                const participants = [...new Set([...(ev.players || []).map(Number), ...(ev.spectators || []).map(Number)])];
                return participants.includes(targetId);
            })
            .map((ev) => ({
                id: Number(ev.id),
                nome: ev.nome || `Evento ${ev.id}`,
                data: ev.data_evento || ev.data || '',
                denuncias: 0,
                reportado: false,
                jogoLimpo: true,
                syntheticReport: false
            }))
            .sort((a, b) => String(b.data || '').localeCompare(String(a.data || '')));
    };

    const _calculateReputation = (jogos = []) => {
        const nota = jogos.reduce((total, jogo) => {
            const denuncias = Math.max(0, Number(jogo.denuncias) || 0);
            return total + (denuncias === 0 ? 0.05 : denuncias * -0.5);
        }, 5);

        return Number(Math.max(0, Math.min(5, nota)).toFixed(2));
    };

    const _renderStarRating = (nota, label = 'Reputacao do jogador') => {
        const score = Math.max(0, Math.min(5, Number(nota) || 0));
        return `
            <span class="rating-stars" role="img" aria-label="${label}: ${score.toFixed(1)} de 5 estrelas">
                ${Array.from({ length: 5 }, (_, index) => {
                    const fill = Math.max(0, Math.min(1, score - index));
                    return `<span class="rating-star" style="--star-fill:${(fill * 100).toFixed(2)}%;" aria-hidden="true">&#9733;</span>`;
                }).join('')}
            </span>
        `;
    };

    const _renderPlayerGamesHistory = (jogos = []) => {
        if (!jogos.length) {
            return '<p class="participants-empty-text">Sem historico suficiente para calcular a reputacao.</p>';
        }

        return jogos.slice(0, 5).map((jogo) => `
            <div class="player-history-item ${Boolean(jogo.reportado || (Number(jogo.denuncias) || 0) > 0) ? 'player-history-item--reported' : 'player-history-item--clean'}">
                <div class="player-history-main">
                    <strong>${jogo.nome || jogo.nome_evento || `Evento ${jogo.id || jogo.id_evento}`}</strong>
                    <span class="player-history-date">${_formatDateBr(String(jogo.data || jogo.data_evento || '').slice(0, 10))}</span>
                </div>
                <span class="player-history-badge ${Boolean(jogo.reportado || (Number(jogo.denuncias) || 0) > 0) ? 'player-history-badge--reported' : 'player-history-badge--clean'}">
                    ${Boolean(jogo.reportado || (Number(jogo.denuncias) || 0) > 0) ? `Denuncias: ${Number(jogo.denuncias) || 0}` : 'Jogo limpo'}
                </span>
            </div>
        `).join('');
    };

    const _getUserProfileSummary = (userId) => {
        const jogos = _getPlayerGames(userId);
        const created = (_state.events || []).filter(ev => Number(ev.creatorId) === Number(userId)).length;
        const joined = jogos.filter((jogo) => !jogo.syntheticReport).length;
        const won = (_state.events || []).filter(ev => ev.resultSummary && String(ev.resultSummary.winnerIds || '').split(',').map(Number).includes(Number(userId))).length;
        const reputation = _calculateReputation(jogos);
        const denunciasTotal = jogos.reduce((total, jogo) => total + Math.max(0, Number(jogo.denuncias) || 0), 0);
        const jogosLimpos = jogos.filter((jogo) => !jogo.syntheticReport && (Number(jogo.denuncias) || 0) === 0).length;
        return {
            reputation,
            partidas: joined,
            eventosCriados: created,
            partidasGanhas: won,
            quadrasMaisFrequentadas: _getFrequentCourtsText(userId),
            denunciasTotal,
            jogosLimpos,
            jogos
        };
    };

    const _ensurePlayerReviewArea = () => {
        const pBio = document.getElementById('infoPlayerBio');
        if (!pBio || !pBio.parentElement) return null;
        let area = document.getElementById('playerReviewArea');
        if (!area) {
            area = document.createElement('div');
            area.id = 'playerReviewArea';
            area.className = 'player-review-area';
            area.innerHTML = `
                <div class="player-summary-header">
                    <div>
                        <p class="player-summary-label">Reputacao atual</p>
                        <div id="playerRatingVisual" class="player-rating-visual"></div>
                    </div>
                    <button type="button" id="playerReportButton" class="player-report-button">Reportar Jogador</button>
                </div>
                <div id="playerSummaryStats" class="player-summary-stats"></div>
                <div id="playerGamesHistory" class="player-games-history"></div>
            `;
            pBio.parentElement.appendChild(area);
        }
        return area;
    };

    const _reportPlayer = async (targetUserId, eventId) => {
        const targetId = Number(targetUserId);
        if (!targetId) return;
        if (targetId === Number(_state.currentUser.id)) {
            _showToast('Voce nao pode reportar o proprio perfil.');
            return;
        }
        const normalizedEventId = Number.isFinite(Number(eventId)) ? Number(eventId) : null;
        if (!normalizedEventId) {
            _showToast('Selecione um evento para registrar o report.');
            return;
        }
        try {
            const result = await reputationRepo.reportPlayer(targetId, normalizedEventId);
            if (!result.ok || !result.success) {
                _showToast(result.message || 'Nao foi possivel registrar o report.');
                return;
            }
            _showToast(result.message || 'Denuncia registrada. A reputacao foi atualizada imediatamente.');
            await _showPlayerDetails(targetId);
        } catch (_) {
            _showToast('Erro de rede ao registrar o report.');
        }
    };

    const _finalizeEventResult = async (eventId) => {
        const ev = _state.events.find((item) => Number(item.id) === Number(eventId));
        if (!ev) return;
        if (!_hasEventEnded(ev)) {
            _showToast('Só é possível avaliar após data e horário de término do evento.');
            return;
        }
        const alvo = [...new Set([...(ev.players || []), ...(ev.spectators || [])])].filter(
            (uid) => Number(uid) !== Number(ev.creatorId)
        );
        if (!alvo.length) {
            _showToast('Não há outros jogadores para avaliar.');
            return;
        }
        const linhas = alvo
            .map((jid) => {
                const nome =
                    (ev.participantNames && ev.participantNames[jid]) || `Jogador ${jid}`;
                return `<div class="avaliacao-jogador-row" data-jid="${jid}">
          <strong>${nome}</strong>
          <label>Gols <input type="number" min="0" max="20" value="0" class="av-inp-gols" data-jid="${jid}"></label>
          <label>Nota 1–5 <input type="number" min="1" max="5" step="0.5" value="4" class="av-inp-nota" data-jid="${jid}"></label>
        </div>`;
            })
            .join("");
        const host = document.getElementById("avaliacaoEventoHost");
        if (host) {
            host.innerHTML = `<p class="participants-empty-text">Avalie gols e desempenho (salvo no banco).</p>${linhas}
        <button type="button" class="btn-modal-submit" id="avaliacaoEventoSalvarBtn">Salvar avaliações</button>`;
            document.getElementById("avaliacaoEventoSalvarBtn").onclick = async () => {
                const avaliacoes = alvo.map((jid) => ({
                    jogador_id: jid,
                    gols: Number(document.querySelector(`.av-inp-gols[data-jid="${jid}"]`)?.value || 0),
                    nota: Number(document.querySelector(`.av-inp-nota[data-jid="${jid}"]`)?.value || 4)
                }));
                try {
                    const r = await fetch(`/api/eventos/${eventId}/avaliar-participantes`, {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        credentials: "include",
                        body: JSON.stringify({ avaliacoes })
                    });
                    const d = await r.json();
                    if (!r.ok || !d.success) {
                        _showToast(d.message || "Falha ao salvar.");
                        return;
                    }
                    _showToast("Avaliações salvas no banco.");
                    _closeModal("avaliacaoEventoModal");
                    await _loadServerData();
                    _renderAll();
                    _openEventDetails(eventId);
                } catch (_) {
                    _showToast("Erro de rede.");
                }
            };
            _openModal("avaliacaoEventoModal");
            return;
        }
        _showToast("Abra o modal de avaliação (recarregue a página se necessário).");
    };

    const _openEventDetails = (id) => {
        const ev = _state.events.find(e => e.id === id);
        if (!ev) return;

        const titleEl = document.getElementById('infoModalTitle');
        const subtitleEl = document.getElementById('infoModalSubtitle');
        const dataEl = document.getElementById('infoEventData');
        const horaInicioEl = document.getElementById('infoEventHoraInicio');
        const horaFimEl = document.getElementById('infoEventHoraFim');
        const descEl = document.getElementById('infoEventDescricao');
        const enderecoEl = document.getElementById('infoEventEndereco');
        const payEl = document.getElementById('infoEventPagamento');
        const actionsEl = document.getElementById('infoEventActions');
        const partEl = document.getElementById('infoEventParticipants');
        const evSection = document.getElementById('infoEventDetails');
        const courtSection = document.getElementById('infoCourtDetails');
        const infoModal = document.getElementById('infoModal');

        if (infoModal) infoModal.dataset.currentEventId = String(ev.id);

        if (titleEl) titleEl.textContent = ev.nome || 'Evento';
        if (subtitleEl) subtitleEl.textContent = `${ev.bairro || ''}${ev.cidade ? ', ' + ev.cidade : ''}`;
        if (dataEl) dataEl.textContent = _formatDateBr(ev.data_evento || ev.data);
        if (horaInicioEl) horaInicioEl.textContent = _formatTime(ev.horario_inicio);
        if (horaFimEl) horaFimEl.textContent = _formatTime(ev.horario_termino);
        if (descEl) descEl.textContent = ev.descricao || 'Sem descrição cadastrada para este evento.';
        const enderecoParts = [ev.rua, ev.numero, ev.bairro, ev.cidade, ev.cep, ev.estado].filter(Boolean);
        if (enderecoEl) enderecoEl.textContent = enderecoParts.length ? enderecoParts.join(', ') : 'Endereço não informado.';

        if (payEl) {
            if (ev.valor && ev.valor > 0) {
                const valorUnitario = ev.valor > 0 && ev.max ? (ev.valor / ev.max).toFixed(2) : null;
                payEl.innerHTML = `
                    <p><strong>Tipo de quadra:</strong> Quadra paga</p>
                    <p><strong>Valor total do aluguel:</strong> R$ ${ev.valor.toFixed(2)}</p>
                    ${valorUnitario ? `<p><strong>Valor por pessoa:</strong> R$ ${valorUnitario}</p>` : ''}
                    <p><strong>Chave PIX do criador:</strong> ${ev.pix || '-'}</p>
                `;
            } else {
                payEl.innerHTML = `
                    <p><strong>Tipo de quadra:</strong> Quadra pública ou evento gratuito</p>
                    <p>Não há cobrança de aluguel cadastrada para este evento.</p>
                `;
            }
        }

        if (actionsEl) {
            _recalculateEventOccupancy(ev);
            const vagas = ev.max - ev.ocupadas;
            const isSubscribed = _state.userSubscriptions.includes(ev.id) || (ev.players || []).includes(_state.currentUser.id);
            const isOwner = Number(ev.creatorId) === Number(_state.currentUser.id);
            const isGuestSelectedEvent = !_state.auth.isLoggedIn && Number(_state.selectedEventId) === Number(ev.id);
            let primaryAction = '';
            if (isOwner) {
                primaryAction = `<button class="btn-modal-submit" onclick="engine.logic.openEditEvent(${ev.id})">Editar evento</button>
                    <button class="btn-modal-cancel" onclick="engine.logic.deleteEvent(${ev.id})">Excluir</button>`;
            } else if (_state.auth.isLoggedIn) {
                primaryAction = isSubscribed
                    ? `<button class="btn-card-secondary-outline" onclick="engine.logic.leaveEvent(${ev.id})">Sair do evento</button>`
                    : `<button class="btn-modal-submit" onclick="engine.logic.handleSubscription(${ev.id})" ${vagas === 0 ? 'disabled' : ''}>${vagas === 0 ? 'Lotado' : 'Quero Jogar'}</button>`;
            } else if (isGuestSelectedEvent) {
                primaryAction = _state.auth.guestPresenceConfirmed
                    ? `<button class="btn-card-secondary-outline" disabled>Presença registrada</button>`
                    : `<button class="btn-modal-submit" onclick="engine.logic.openGuestPresenceModal()">Confirmar presença</button>`;
            } else {
                primaryAction = `<a class="btn-modal-submit header-auth-link" href="/login">Login para participar</a>`;
            }
            actionsEl.innerHTML = `
                ${primaryAction}
                <button class="btn-card-secondary-outline" onclick="engine.logic.abrirLocalizacao('${ev.rua || ""}', '', '${ev.bairro || ""}', '${ev.cidade || ""}', '', ${ev.latitude != null ? Number(ev.latitude) : 'null'}, ${ev.longitude != null ? Number(ev.longitude) : 'null'})">Mapa</button>
                <button class="btn-card-secondary-outline" onclick="engine.logic.openInviteQrModal(${ev.id})">QR Convite</button>
                <button class="btn-card-secondary-outline" onclick="engine.logic.shareEvent(${ev.id})">Compartilhar</button>
                ${isOwner && (_hasEventEnded(ev) || ev.finalizado) ? `<button class="btn-modal-submit" onclick="engine.logic.finalizeEventResult(${ev.id})">Avaliar jogadores (gols / nota)</button>` : ''}
            `;
        }
        const invRow = document.getElementById('infoEventInviteRow');
        const invSel = document.getElementById('infoInviteFriendSelect');
        const invBtn = document.getElementById('infoInviteFriendBtn');
        if (invRow && invSel && invBtn) {
            const isOwner = Number(ev.creatorId) === Number(_state.currentUser.id);
            invRow.style.display = isOwner ? 'flex' : 'none';
            if (isOwner) {
                fetch('/api/amizades/lista', { credentials: 'include' }).then(r => r.json()).then(d => {
                    const amigos = (d.amigos || []);
                    invSel.innerHTML = '<option value="">Amigo...</option>' + amigos.map(a => `<option value="${a.amigo_id}">${a.nome}</option>`).join('');
                }).catch(() => { invSel.innerHTML = '<option value="">—</option>'; });
                invBtn.onclick = async () => {
                    const uid = Number(invSel.value);
                    if (!uid) { _showToast('Escolha um amigo.'); return; }
                    try {
                        const r = await fetch(`/eventos/${ev.id}/convidar`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            credentials: 'include',
                            body: JSON.stringify({ usuario_id: uid })
                        });
                        const d = await r.json();
                        if (d.success) { _showToast('Convite registrado!'); await _loadServerData(); _renderAll(); _openEventDetails(ev.id); }
                        else _showToast(d.message || 'Falha.');
                    } catch (_) { _showToast('Erro de rede.'); }
                };
            }
        }

        if (partEl) {
            const participantes = [...new Set([...(ev.players||[]), ...(ev.spectators||[]), ev.creatorId])];
            const playersHtml = participantes.map(pid => {
                const p = { nome: (ev.participantNames && ev.participantNames[pid]) || (_players[pid] && _players[pid].nome) || (pid===ev.creatorId ? ev.creatorName : `Jogador ${pid}`) };
                const crown = pid===ev.creatorId ? ' <i class="fas fa-crown" style="color:#f59e0b"></i>' : '';
                return `<button class="participant-chip" onclick="event.stopPropagation(); engine.logic.showPlayerDetails(${pid});">${p.nome}${crown}</button>`;
            });
            const guestsHtml = (ev.guestParticipants || []).map((guest) =>
                `<div class="participant-chip">${guest.nome} <span style="opacity:0.7;">• Convidado</span></div>`
            );
            partEl.innerHTML = [...playersHtml, ...guestsHtml].join('');
        }
        const specEl = document.getElementById('infoSpectatorsList');
        const playersEl = document.getElementById('infoPlayersList');
        const renderRoleList = (arr, role, target) => {
            if (!target) return;
            target.innerHTML = (arr||[]).length ? arr.map(uid => {
                const p = { nome: (ev.participantNames && ev.participantNames[uid]) || (_players[uid] && _players[uid].nome) || (uid===ev.creatorId ? ev.creatorName : `Jogador ${uid}`) };
                const isOwner = ev.creatorId === _state.currentUser.id;
                const actions = isOwner && uid !== ev.creatorId ? `<button type="button" onclick="engine.logic.toggleRole(${ev.id},${uid},'${role==='player'?'spectator':'player'}')">Mover</button><button type="button" onclick="engine.logic.removeFromEvent(${ev.id},${uid})">Excluir</button>` : '';
                return `<div class="participant-chip">${p.nome}${uid===ev.creatorId?' <i class="fas fa-crown" style="color:#f59e0b"></i>':''} ${actions}</div>`;
            }).join('') : '<p class="participants-empty-text">Lista vazia.</p>';
        };
        renderRoleList(ev.spectators||[], 'spectator', specEl);
        renderRoleList(ev.players||[], 'player', playersEl);
        if (specEl && Array.isArray(ev.guestParticipants) && ev.guestParticipants.length) {
            const existing = specEl.innerHTML === '<p class="participants-empty-text">Lista vazia.</p>' ? '' : specEl.innerHTML;
            const guestsHtml = ev.guestParticipants
                .map((guest) => `<div class="participant-chip">${guest.nome} <span style="opacity:0.7;">• Convidado</span></div>`)
                .join('');
            specEl.innerHTML = `${existing}${guestsHtml}`;
        }

        const msgWrap = document.getElementById('eventChatMessages');
        const msgInput = document.getElementById('eventChatInput');
        const msgBtn = document.getElementById('eventChatSendBtn');
        const hint = document.getElementById('eventChatHint');
        const msgs = _state.eventChats[ev.id] || [];
        if (msgWrap) msgWrap.innerHTML = msgs.map(m => `<div><strong>${m.userName}:</strong> ${m.text}</div>`).join('') || '<p class="participants-empty-text">Sem mensagens.</p>';
        const canSend = _isInEvent(ev);
        if (hint) hint.textContent = canSend ? 'Você pode enviar mensagens neste evento.' : 'Apenas quem está no evento pode enviar mensagens.';
        if (msgInput) msgInput.disabled = !canSend;
        if (msgBtn) msgBtn.disabled = !canSend;
        if (msgBtn) msgBtn.onclick = () => {
            const canSendNow = _isInEvent(ev);
            if (!canSendNow) return _showToast('Apenas participantes podem enviar mensagens.');
            const text = (msgInput?.value || '').trim();
            if (!text) return;
            _state.eventChats[ev.id] = [...(_state.eventChats[ev.id] || []), { userId:_state.currentUser.id, userName:_state.currentUser.name, text }];
            _syncStorage();
            _openEventDetails(ev.id);
        };

        const pNome = document.getElementById('infoPlayerNome');
        const pMeta = document.getElementById('infoPlayerMeta');
        const pBio = document.getElementById('infoPlayerBio');
        if (pNome) pNome.textContent = 'Selecione um jogador acima';
        if (pMeta) pMeta.textContent = '';
        if (pBio) pBio.textContent = '';
        const reviewArea = _ensurePlayerReviewArea();
        if (reviewArea) {
            reviewArea.dataset.targetUserId = '';
            reviewArea.dataset.currentEventId = String(ev.id || '');
            const statsWrap = document.getElementById('playerSummaryStats');
            const ratingWrap = document.getElementById('playerRatingVisual');
            const gamesHistoryWrap = document.getElementById('playerGamesHistory');
            const reportBtn = document.getElementById('playerReportButton');
            if (statsWrap) statsWrap.innerHTML = '';
            if (ratingWrap) ratingWrap.innerHTML = '<span class="player-rating-caption">Selecione um jogador para ver a reputacao em estrelas.</span>';
            if (gamesHistoryWrap) gamesHistoryWrap.innerHTML = '';
            if (reportBtn) {
                reportBtn.disabled = true;
                reportBtn.onclick = null;
            }
        }

        if (evSection) evSection.style.display = 'block';
        if (courtSection) courtSection.style.display = 'none';

        _openModal('infoModal');
    };

    const _showPlayerDetails = async (id) => {
        const numId = Number(id);
        const pNome = document.getElementById('infoPlayerNome');
        const pMeta = document.getElementById('infoPlayerMeta');
        const pBio = document.getElementById('infoPlayerBio');
        const fallbackSummary = _getUserProfileSummary(Number(id));
        const ratingWrap = document.getElementById('playerRatingVisual');
        const statsWrap = document.getElementById('playerSummaryStats');
        const gamesHistoryWrap = document.getElementById('playerGamesHistory');
        const reviewArea = _ensurePlayerReviewArea();
        const reportBtn = document.getElementById('playerReportButton');

        const applySummaryToDom = (profileSummary, extraStats = []) => {
            const safeSummary = {
                ...fallbackSummary,
                ...(profileSummary || {})
            };
            if (ratingWrap) {
                ratingWrap.innerHTML = `
                    <span class="rating-value">${Number(safeSummary.reputation || 0).toFixed(1)}</span>
                    ${_renderStarRating(safeSummary.reputation, 'Reputacao do jogador selecionado')}
                    <span class="player-rating-caption">${safeSummary.jogosLimpos} jogo(s) limpo(s) e ${safeSummary.denunciasTotal} denuncia(s) acumulada(s).</span>
                `;
            }
            if (statsWrap) {
                statsWrap.innerHTML = [
                    `<div class="player-stat-row"><span>Partidas finalizadas</span><strong>${safeSummary.partidas}</strong></div>`,
                    `<div class="player-stat-row"><span>Jogos limpos</span><strong>${safeSummary.jogosLimpos}</strong></div>`,
                    `<div class="player-stat-row"><span>Denuncias</span><strong>${safeSummary.denunciasTotal}</strong></div>`,
                    `<div class="player-stat-row"><span>Partidas ganhas</span><strong>${safeSummary.partidasGanhas}</strong></div>`,
                    ...extraStats
                ].join('');
            }
            if (gamesHistoryWrap) gamesHistoryWrap.innerHTML = _renderPlayerGamesHistory(safeSummary.jogos || []);
            if (reviewArea) reviewArea.dataset.targetUserId = String(numId);
            if (reportBtn) {
                const isSelf = numId === Number(_state.currentUser.id);
                reportBtn.disabled = isSelf;
                reportBtn.textContent = isSelf ? 'Este e voce' : 'Reportar Jogador';
                reportBtn.onclick = isSelf ? null : () => { void _reportPlayer(numId, Number(reviewArea?.dataset.currentEventId || 0)); };
            }
        };

        if (Number.isFinite(numId) && numId > 0) {
            try {
                const d = await reputationRepo.getProfile(numId);
                if (d.ok && d.success && d.perfil) {
                    const u = d.perfil;
                    const apiSummary = {
                        reputation: Number(u.reputacao_partidas ?? fallbackSummary.reputation),
                        jogosLimpos: Number(u.jogos_limpos ?? fallbackSummary.jogosLimpos),
                        denunciasTotal: Number(u.reports_recebidos ?? fallbackSummary.denunciasTotal),
                        partidas: Number(u.partidas_reputacao ?? fallbackSummary.partidas),
                        partidasGanhas: Number(u.partidas_ganhas ?? fallbackSummary.partidasGanhas),
                        quadrasMaisFrequentadas: fallbackSummary.quadrasMaisFrequentadas,
                        jogos: Array.isArray(u.historico_reputacao) ? u.historico_reputacao : fallbackSummary.jogos
                    };
                    if (pNome) pNome.textContent = u.nome_user || `Jogador ${numId}`;
                    if (pMeta) pMeta.textContent = [u.bairro_user, u.cidade_user].filter(Boolean).join(' • ') || '—';
                    if (pBio) pBio.textContent = u.bio || 'Sem bio cadastrada.';
                    applySummaryToDom(apiSummary, [
                        `<div class="player-stat-row"><span>Gols</span><strong>${u.gols ?? '—'}</strong></div>`,
                        `<div class="player-stat-row"><span>Quadras frequentes</span><strong>${fallbackSummary.quadrasMaisFrequentadas}</strong></div>`
                    ]);
                    return;
                }
            } catch (_) {}
        }

        const p = _players[id];
        if (pNome) pNome.textContent = (p && p.nome) || (_state.currentUser.id === Number(id) ? _state.currentUser.name : `Jogador ${id}`);
        if (pMeta) pMeta.textContent = p ? `${p.idade} anos • ${p.posicao} • ${p.bairro}, ${p.cidade}` : `Perfil do jogador ${id}`;
        if (pBio) pBio.textContent = (p && p.bio) || 'Sem bio cadastrada.';
        applySummaryToDom(fallbackSummary, [
            `<div class="player-stat-row"><span>Eventos criados</span><strong>${fallbackSummary.eventosCriados}</strong></div>`,
            `<div class="player-stat-row"><span>Quadras frequentes</span><strong>${fallbackSummary.quadrasMaisFrequentadas}</strong></div>`
        ]);
    };

    const _openCourtDetails = (id) => {
        const c = _courts.find(q => q.id === id);
        if (!c) return;

        const titleEl = document.getElementById('infoModalTitle');
        const subtitleEl = document.getElementById('infoModalSubtitle');
        const courtSection = document.getElementById('infoCourtDetails');
        const evSection = document.getElementById('infoEventDetails');
        const endEl = document.getElementById('infoCourtEndereco');
        const metaEl = document.getElementById('infoCourtMeta');
        const dispEl = document.getElementById('infoCourtDisponibilidade');
        const activeEventsEl = document.getElementById('infoCourtActiveEvents');
        const ownerEl = document.getElementById('infoCourtOwner');
        const ownerBtn = document.getElementById('infoCourtOwnerProfileBtn');
        const ownerAct = document.getElementById('infoCourtOwnerActions');

        if (ownerEl) ownerEl.textContent = `Proprietário: ${c.ownerName || '—'}`;
        if (ownerBtn) {
            ownerBtn.style.display = c.ownerId ? 'inline-block' : 'none';
            ownerBtn.onclick = () => _verPerfil(Number(c.ownerId));
        }
        if (ownerAct) {
            const isCourtOwner = Number(c.ownerId) === Number(_state.currentUser.id);
            ownerAct.innerHTML = isCourtOwner
                ? `<button type="button" class="btn-modal-submit" onclick="engine.logic.openEditCourt(${c.id})">Editar quadra</button>
                   <button type="button" class="btn-modal-cancel" onclick="engine.logic.deleteCourt(${c.id})">Excluir quadra</button>`
                : '';
        }

        if (titleEl) titleEl.textContent = c.nome || 'Quadra';
        if (subtitleEl) subtitleEl.textContent = `${c.bairro || ''}${c.cidade ? ', ' + c.cidade : ''}`;

        if (endEl) {
            const partes = [];
            if (c.rua) partes.push(c.rua);
            if (c.numero) partes.push(c.numero);
            if (c.bairro) partes.push(c.bairro);
            if (c.cidade) partes.push(c.cidade);
            if (c.estado) partes.push(c.estado);
            endEl.textContent = partes.join(', ');
        }

        if (metaEl) {
            metaEl.textContent = `${c.esporte || ''} • Capacidade ${c.capacidade || '-'} • ${c.tipo || ''}`;
        }

        if (dispEl) {
            const d = c.disponibilidade;
            if (d && d.dias && d.inicio && d.fim) {
                dispEl.textContent = `Disponível de ${d.dias.join(', ')} das ${d.inicio} às ${d.fim}.`;
            } else {
                dispEl.textContent = 'Disponibilidade de horários não cadastrada para esta quadra.';
            }
        }
        if (activeEventsEl) {
            const today = new Date();
            today.setHours(0,0,0,0);
            const activeEvents = (_state.events || []).filter(ev => {
                const sameCourt = Number(ev.quadra_id || 0) === Number(c.id);
                if (!sameCourt) return false;
                const dateStr = ev.data_evento || ev.data;
                if (!dateStr) return true;
                const d = new Date(dateStr + 'T00:00:00');
                if (Number.isNaN(d.getTime())) return true;
                return d >= today;
            });

            if (!activeEvents.length) {
                activeEventsEl.innerHTML = '<p class="participants-empty-text">Nenhum evento ativo nesta quadra.</p>';
            } else {
                activeEventsEl.innerHTML = activeEvents.map(ev => `
                    <button class="participant-chip" onclick="event.stopPropagation(); engine.logic.openEventDetails(${ev.id});">
                        ${ev.nome || 'Evento'} • ${_formatDateBr(ev.data_evento || ev.data)} • ${_formatTime(ev.horario_inicio)}
                    </button>
                `).join('');
            }
        }

        if (evSection) evSection.style.display = 'none';
        if (courtSection) courtSection.style.display = 'block';
        const infoModal = document.getElementById('infoModal');
        if (infoModal) infoModal.dataset.currentEventId = '';

        _openModal('infoModal');
    };

    const _abrirLocalizacao = async (rua, numero, bairro, cidade, estado, latitude = null, longitude = null) => {
        try {
            _showToast("Buscando rota...");
            const dadosEndereco = { rua, numero, bairro, cidade, estado, latitude, longitude };

            const response = await fetch("/api/gerar-mapa", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(dadosEndereco)
            });

            const resultado = await response.json();

            if (resultado.sucesso) {
                window.open(resultado.url_google_maps, '_blank');
            } else {
                _showToast("Erro ao gerar link do mapa");
            }
        } catch (error) {
            console.error("Erro na API Python:", error);
            _showToast("A API do mapa (Python) está offline!");
        }
    };

    const _initGeolocation = () => {
        if (!navigator.geolocation) {
            _showToast("Seu navegador não suporta geolocalização.");
            return;
        }

        navigator.geolocation.getCurrentPosition(
            async (position) => {
                try {
                    const { latitude, longitude } = position.coords;

                    const response = await fetch(
                        `https://nominatim.openstreetmap.org/reverse?format=json&lat=${latitude}&lon=${longitude}`
                    );
                    const data = await response.json();

                    const addr = data.address || {};
                    const city =
                        addr.city ||
                        addr.town ||
                        addr.village ||
                        addr.city_district ||
                        null;

                    if (city) {
                        _state.userCity = city;
                        _showToast(`Filtrando quadras em ${city}.`);
                        _renderCourts();
                    } else {
                        _showToast("Não foi possível detectar a cidade pela localização.");
                    }
                } catch (e) {
                    console.error("Erro ao obter cidade pela geolocalização:", e);
                    _showToast("Erro ao buscar sua cidade.");
                }
            },
            (error) => {
                console.warn("Erro na geolocalização:", error);
                _showToast("Permissão de localização negada ou indisponível.");
            },
            {
                enableHighAccuracy: true,
                timeout: 10000,
                maximumAge: 600000
            }
        );
    };

    // --------------------
    // INTERFACE (UI AUX)
    // --------------------
    const _validarEBuscarCEP = async (cep) => {
        // Remove caracteres não numéricos
        const limpo = cep.replace(/\D/g, '');

        // Validação básica de formato (8 dígitos)
        if (limpo.length !== 8) {
            _showToast("CEP Inválido! Use 8 dígitos.");
            return;
        }

        try {
            _showToast("Validando CEP...");
            const response = await fetch(`https://viacep.com.br/ws/${limpo}/json/`);
            const data = await response.json();
            if (!response.ok) {
                throw new Error(`Erro HTTP: ${response.status}`);

            }



            if (data.erro) {
                _showToast("CEP não encontrado na base de dados.");
                return;
            }

            // Se encontrou, preenche os campos automaticamente
            if (document.getElementById('sql_rua')) document.getElementById('sql_rua').value = data.logradouro;
            if (document.getElementById('sql_bairro')) document.getElementById('sql_bairro').value = data.bairro;
            if (document.getElementById('sql_cidade')) document.getElementById('sql_cidade').value = data.localidade;
            if (document.getElementById('sql_estado')) document.getElementById('sql_estado').value = data.uf;
            _showToast("Endereço validado com sucesso!");
        } catch (error) {
            _showToast("Erro ao validar CEP. Verifique sua conexão.");
        }
    };

    const _openModalWithData = (modalId, data) => {
        const campos = {
            'sql_rua': data.rua,
            'sql_bairro': data.bairro,
            'sql_cidade': data.cidade,
            'sql_cep': data.cep
        };
        for (const [id, value] of Object.entries(campos)) {
            const input = document.getElementById(id);
            if (input) input.value = value || '';
        }
        _openModal(modalId);
    };

    const _toggleMenuPaymentFields = () => {
        const tipo = document.getElementById('sql_quadra')?.value;
        const block = document.getElementById('eventMenuPaymentFields');
        const valor = document.getElementById('sql_valor');
        const banco = document.getElementById('sql_banco');
        const titular = document.getElementById('sql_titular');
        const pix = document.getElementById('sql_pix');
        const isAlugada = (tipo || '').toLowerCase().includes('alugada');
        if (block) block.style.display = isAlugada ? 'block' : 'none';
        [valor, banco, titular, pix].forEach(el => { if (el) el.required = isAlugada; });
    };

    const _updateEventFromCourtPrice = () => {
        const courtId = Number(document.getElementById('event_court_quadra_id')?.value || 0);
        const court = _courts.find(q => Number(q.id) === courtId);
        const priceInput = document.getElementById('event_court_valor');
        if (!priceInput) return;
        const selectedCount = document.querySelectorAll('#privateCourtSlotsGrid .private-slot.slot-blue').length;
        const pricePerSlot = Number(court?.preco_30min || 0);
        priceInput.value = selectedCount ? (selectedCount * pricePerSlot).toFixed(2) : '';
    };

    const _toggleCourtPaymentFields = () => {
        const courtId = Number(document.getElementById('event_court_quadra_id')?.value || 0);
        const selectedType = document.getElementById('event_court_quadra')?.value;
        const actualCourt = _courts.find(q => Number(q.id) === courtId);
        const isPrivateCourt = _isPrivateCourtType(actualCourt?.tipo || selectedType);
        const block = document.getElementById('eventCourtPaymentFields');
        const docsBlock = document.getElementById('eventCourtRentalDocsSection');
        const slotsBlock = document.getElementById('privateCourtTimePickerSection');
        const valor = document.getElementById('event_court_valor');
        const pix = document.getElementById('event_court_pix');
        if (block) block.style.display = isPrivateCourt ? 'block' : 'none';
        if (docsBlock) docsBlock.style.display = isPrivateCourt ? 'block' : 'none';
        if (slotsBlock) slotsBlock.style.display = isPrivateCourt ? 'block' : 'none';
        [valor, pix].forEach(el => { if (el) el.required = isPrivateCourt; });
        _updateEventFromCourtPrice();
    };

    const _openCreateEventFromCourt = (courtId) => {
        const c = _courts.find(q => q.id === courtId);
        if (!c) return;
        document.getElementById('createEventFromCourtSubtitle').textContent = `Quadra: ${c.nome || 'Sem nome'}`;
        document.getElementById('event_court_quadra_id').value = String(c.id);
        document.getElementById('event_court_cep').value = c.cep || '';
        document.getElementById('event_court_cidade').value = c.cidade || '';
        document.getElementById('event_court_bairro').value = c.bairro || '';
        document.getElementById('event_court_estado').value = c.estado || '';
        document.getElementById('event_court_rua').value = c.rua || '';
        document.getElementById('event_court_numero').value = c.numero || '';
        const tipoSelect = document.getElementById('event_court_quadra');
        if (tipoSelect) {
            const tipo = (c.tipo || 'Quadra publica').toLowerCase().includes('alugada') ? 'Quadra Alugada' : 'Quadra publica';
            tipoSelect.value = tipo;
        }
        const maxInput = document.getElementById('event_court_max');
        if (maxInput) { maxInput.max = String(c.capacidade || 0); maxInput.value = String(c.capacidade || 0); }
        const esporteSelect = document.getElementById('event_court_esporte');
        if (esporteSelect && c.esportes_disponiveis) {
            esporteSelect.innerHTML = String(c.esportes_disponiveis).split(',').map(v => v.trim()).filter(Boolean).map(v => `<option value="${v}">${v}</option>`).join('');
        }
        const pixInput = document.getElementById('event_court_pix');
        if (pixInput) pixInput.value = '';
        _toggleCourtPaymentFields();
        _renderPrivateSlotsForCourt(c);
        _openModal('createEventFromCourtModal');
    };

    const _resolveThemeMode = (theme) => {
        if (theme !== 'auto') return theme;
        const hour = new Date().getHours();
        return (hour >= 6 && hour < 18) ? 'light' : 'dark';
    };

    const _syncThemeOptionCards = () => {
        document.querySelectorAll('[data-theme-option]').forEach(card => {
            card.classList.toggle('active', card.getAttribute('data-theme-option') === _state.currentUser.theme);
        });
    };

    const _toggleProfileDropdown = (force) => {
        const menu = document.getElementById('profileDropdownMenu');
        if (!menu) return;
        const shouldOpen = typeof force === 'boolean' ? force : !menu.classList.contains('active');
        menu.classList.toggle('active', shouldOpen);
    };

    const _saveProfileSettings = async () => {
        const fullName = document.getElementById('settingsFullName')?.value?.trim();
        const bio = document.getElementById('settingsBio')?.value?.trim() || '';
        if (!fullName) { _showToast('Informe seu nome para salvar o perfil.'); return; }
        const payload = { nome_user: fullName, bio };
        const fp = _state.currentUser.photo;
        if (fp && String(fp).startsWith('data:image')) {
            payload.foto_perfil = fp.length > 400000 ? fp.slice(0, 400000) : fp;
        }
        try {
            const response = await fetch('/api/me', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify(payload)
            });
            const result = await response.json();
            if (!response.ok || !result.success) {
                _showToast(result.message || 'Não foi possível salvar no servidor.');
                return;
            }
        } catch (_) {
            _showToast('Erro de conexão ao salvar perfil.');
            return;
        }
        _state.currentUser.name = fullName;
        _state.currentUser.bio = bio;
        _syncStorage();
        _renderProfileVisuals();
        _renderAll();
        _showToast('Perfil salvo no banco de dados.');
    };

    const _savePreferences = () => {
        _state.preferences = {
            emailNotifications: !!document.getElementById('settingsEmailNotifications')?.checked,
            publicProfile: !!document.getElementById('settingsPublicProfile')?.checked,
            matchReminders: !!document.getElementById('settingsMatchReminders')?.checked,
            darkAtNight: !!document.getElementById('settingsDarkAtNight')?.checked
        };
        if (_state.preferences.darkAtNight && _state.currentUser.theme !== 'auto') _applyTheme('auto');
        _syncStorage();
        _showToast('Preferências salvas com sucesso!');
    };

    const _changePassword = async () => {
        const currentPassword = document.getElementById('settingsCurrentPassword')?.value || '';
        const newPassword = document.getElementById('settingsNewPassword')?.value || '';
        const confirmPassword = document.getElementById('settingsConfirmPassword')?.value || '';

        if (!currentPassword || !newPassword || !confirmPassword) { _showToast('Preencha todos os campos da senha.'); return; }
        if (newPassword.length < 6) { _showToast('A nova senha deve ter pelo menos 6 caracteres.'); return; }
        if (newPassword !== confirmPassword) { _showToast('A confirmação da nova senha não confere.'); return; }

        try {
            const response = await fetch("/auth", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                credentials: 'include',
                body: JSON.stringify({
                    acao: 'alterar_senha',
                    senha_atual: currentPassword,
                    nova_senha: newPassword
                })
            });
            const result = await response.json();
            if (!response.ok || !result.success) { _showToast(result.message || 'Não foi possível alterar a senha.'); return; }
            ['settingsCurrentPassword','settingsNewPassword','settingsConfirmPassword'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
            _showToast('Senha alterada com sucesso!');
        } catch (_) {
            _showToast('Erro ao alterar a senha. Tente novamente.');
        }
    };

    const _applyTheme = (theme) => {
        const resolvedTheme = _resolveThemeMode(theme);
        document.documentElement.setAttribute('data-theme', resolvedTheme);
        _state.currentUser.theme = theme;
        localStorage.setItem('bs_v12_theme', theme);
        _syncThemeOptionCards();
    };

    const _openModal = (id) => {
        const m = document.getElementById(id);
        const o = document.getElementById('globalOverlay');
        if (m) m.classList.add('active');
        if (o) o.classList.add('active');
        document.body.style.overflow = 'hidden';
    };

    const _closeModal = (id) => {
        const m = document.getElementById(id);
        const o = document.getElementById('globalOverlay');
        if (m) m.classList.remove('active');
        if (o) o.classList.remove('active');
        document.body.style.overflow = 'auto';
    };

    const _showToast = (msg) => {
        const container = document.getElementById('toastContainer');
        if (!container) return;
        const toast = document.createElement('div');
        toast.className = 'toast';
        toast.innerText = msg;
        container.appendChild(toast);
        setTimeout(() => toast.remove(), 4000);
    };

    const _applyAccessMode = () => {
        if (_state.auth.isLoggedIn) return;
        ['triggerCreateModal', 'triggerCreateCourtModal', 'openMyCourtsCreateBtn'].forEach((id) => {
            const el = document.getElementById(id);
            if (el) el.style.display = 'none';
        });
        ['history', 'my-events', 'settings'].forEach((view) => {
            document.querySelectorAll(`.nav-link-item[data-view="${view}"]`).forEach((el) => {
                el.style.display = 'none';
            });
        });
    };

    const _openGuestPresenceModal = () => {
        const modal = document.getElementById('modalGuestPresenca');
        if (!modal || !_state.auth.isGuestFlow || _state.auth.guestPresenceConfirmed) return;
        const eventIdInput = document.getElementById('guestEventId');
        if (eventIdInput && _state.selectedEventId) eventIdInput.value = String(_state.selectedEventId);
        _openModal('modalGuestPresenca');
    };

    const _submitGuestPresence = async () => {
        const eventId = Number(document.getElementById('guestEventId')?.value || _state.selectedEventId || 0);
        const payload = {
            id_evento: eventId,
            nome: document.getElementById('guestNome')?.value?.trim() || '',
            cpf: document.getElementById('guestCpf')?.value?.trim() || '',
            idade: document.getElementById('guestIdade')?.value || '',
            peso: document.getElementById('guestPeso')?.value || '',
            altura: document.getElementById('guestAltura')?.value || ''
        };
        const submitBtn = document.getElementById('guestPresencaSubmitBtn');
        if (!payload.id_evento) {
            _showToast('Evento inválido para confirmar presença.');
            return;
        }
        if (!payload.nome || !payload.cpf || !payload.idade || !payload.peso || !payload.altura) {
            _showToast('Preencha todos os campos para confirmar presença.');
            return;
        }
        if (submitBtn) submitBtn.disabled = true;
        try {
            const response = await fetch('/api/presenca-guest', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify(payload)
            });
            const result = await response.json();
            if (!response.ok || !result.success) {
                console.error('Erro em /api/presenca-guest:', result);
                _showToast(result.message || 'Não foi possível registrar a presença.');
                return;
            }
            _state.auth.guestPresenceConfirmed = true;
            _state.currentUser.name = result.convidado?.nome_guest || payload.nome;
            _renderProfileVisuals();
            _closeModal('modalGuestPresenca');
            _showToast(result.message || 'Presença confirmada.');
            await fetchEvents({ silent: true });
            _renderAll();
            if (eventId) _openEventDetails(eventId);
        } catch (error) {
            console.error('Falha ao registrar presença guest:', error);
            _showToast('Erro de conexão ao registrar presença.');
        } finally {
            if (submitBtn) submitBtn.disabled = false;
        }
    };

    const _startEventsPolling = () => {
        if (_eventsPollTimer) clearInterval(_eventsPollTimer);
        _eventsPollTimer = setInterval(async () => {
            try {
                await fetchEvents({ silent: true });
                _renderAll();
                const infoModal = document.getElementById('infoModal');
                const openEventId = Number(infoModal?.dataset?.currentEventId || 0);
                if (infoModal?.classList.contains('active') && openEventId) {
                    _openEventDetails(openEventId);
                }
            } catch (_) {}
        }, 15000);
    };

    const _openEditEvent = (id) => {
        const ev = _state.events.find((e) => Number(e.id) === Number(id));
        if (!ev) return;
        const hid = document.getElementById("sql_edit_event_id");
        if (hid) hid.value = String(id);
        const setv = (eid, v) => {
            const el = document.getElementById(eid);
            if (el) el.value = v ?? "";
        };
        setv("sql_nome", ev.nome);
        setv("sql_esporte", ev.esporte);
        setv("sql_max", ev.max);
        const gen = (ev.genero || "misto").toLowerCase();
        setv("sql_genero", gen.charAt(0).toUpperCase() + gen.slice(1));
        setv("sql_data", ev.data_evento || ev.data);
        setv("sql_inicio", _formatTime(ev.horario_inicio));
        setv("sql_fim", _formatTime(ev.horario_termino));
        setv("sql_faixa", ev.faixa_etaria);
        setv("sql_desc", ev.descricao);
        setv("sql_cep", ev.cep);
        setv("sql_numero", ev.numero != null ? String(ev.numero) : "");
        setv("sql_cidade", ev.cidade);
        setv("sql_bairro", ev.bairro);
        setv("sql_rua", ev.rua);
        setv("sql_valor", ev.valor > 0 ? String(ev.valor) : "");
        setv("sql_pix", ev.pix);
        setv("sql_banco", ev.banco);
        setv("sql_titular", ev.titular);
        _closeModal("infoModal");
        _openModal("createModal");
        _showToast("Altere os campos e salve.");
    };

    const _openEditCourt = (id) => {
        const c = _courts.find((q) => Number(q.id) === Number(id));
        if (!c) return;
        window._editingCourtId = id;
        const setv = (eid, v) => {
            const el = document.getElementById(eid);
            if (el) el.value = v ?? "";
        };
        setv("court_nome", c.nome);
        setv("court_cidade", c.cidade);
        setv("court_bairro", c.bairro);
        setv("court_estado", c.estado);
        setv("court_rua", c.rua);
        setv("court_cep", c.cep);
        setv("court_capacidade", c.capacidade);
        setv("court_esportes_lista", c.esporte);
        _closeModal("infoModal");
        _openModal("createCourtModal");
        _showToast("Edite e salve para atualizar a quadra.");
    };

    const _deleteCourt = async (id) => {
        if (!confirm("Excluir esta quadra?")) return;
        try {
            const r = await fetch(`/quadra/${id}`, { method: "DELETE", credentials: "include" });
            const d = await r.json();
            if (d.success) {
                _showToast("Quadra excluída.");
                await _loadServerData();
                _renderAll();
                _closeModal("infoModal");
            } else _showToast(d.message || "Falha.");
        } catch (_) {
            _showToast("Erro de rede.");
        }
    };

    const _aceitarAmizade = async (aid) => {
        try {
            const r = await fetch(`/api/amizades/${aid}/aceitar`, { method: "POST", credentials: "include" });
            const d = await r.json();
            if (d.success) { _showToast("Amizade aceita!"); _loadFriendsDropdown(); }
            else _showToast(d.message || "Não foi possível aceitar.");
        } catch (_) { _showToast("Erro de rede."); }
    };

    const _recusarAmizade = async (aid) => {
        try {
            const r = await fetch(`/api/amizades/${aid}/recusar`, { method: "POST", credentials: "include" });
            const d = await r.json();
            if (d.success) { _showToast("Pedido recusado."); _loadFriendsDropdown(); }
            else _showToast(d.message || "Falha.");
        } catch (_) { _showToast("Erro de rede."); }
    };

    const _verPerfil = async (uid) => {
        try {
            const r = await fetch(`/api/perfil/${uid}`, { credentials: "include" });
            const d = await r.json();
            if (!d.success) { _showToast(d.message || "Perfil não encontrado."); return; }
            const p = d.perfil;
            const nome = p.nome_user || "Atleta";
            const loc = [p.bairro_user, p.cidade_user].filter(Boolean).join(", ");
            const lines = [
                nome,
                loc,
                `Partidas ganhas: ${p.partidas_ganhas ?? "—"}`,
                `Gols: ${p.gols ?? "—"}`,
                `Reputação: ${p.reputacao_partidas ?? "—"}`,
                p.bio || ""
            ].filter(Boolean);
            window.alert(lines.join("\n"));
        } catch (_) { _showToast("Erro ao carregar perfil."); }
    };

    const _setupDOMListeners = () => {
        _injectSportsIntoProfilePane();
        _applyRuntimeLayoutFixes();
        const courtCep = document.getElementById('court_cep');
        if (courtCep) {
            courtCep.addEventListener('blur', async (e) => {
                const cep = e.target.value.replace(/\D/g, '');
                if (cep.length !== 8) return;

                try {
                    const response = await fetch(`https://viacep.com.br/ws/${cep}/json/`);
                    const data = await response.json();

                    if (!data.erro) {
                        document.getElementById('court_rua').value = data.logradouro || "";
                        document.getElementById('court_bairro').value = data.bairro || "";
                        document.getElementById('court_cidade').value = data.localidade || "";
                        document.getElementById('court_estado').value = data.uf || "";
                    }
                } catch (err) {
                    _showToast("Erro ao buscar CEP da quadra.");
                }
            });
        }
        if (document.getElementById('triggerCreateCourtModal'))
            document.getElementById('triggerCreateCourtModal').onclick = () => {
                window._editingCourtId = null;
                _openModal('createCourtModal');
            };

        const sidebarLogo = document.getElementById('sidebarLogo');
        const headerMenuToggle = document.getElementById('headerMenuToggle');
        const sidebarMobileBackdrop = document.getElementById('sidebarMobileBackdrop');
        const sidebar = document.getElementById('sidebar');
        const setSidebarMobileState = (open) => {
            sidebar?.classList.toggle('mobile-open', open);
            sidebarMobileBackdrop?.classList.toggle('active', open);
            document.body.classList.toggle('sidebar-mobile-open', open);
            headerMenuToggle?.setAttribute('aria-expanded', open ? 'true' : 'false');
        };
        const toggleSidebar = () => {
            if (window.innerWidth <= 768) {
                const isOpen = sidebar?.classList.contains('mobile-open');
                setSidebarMobileState(!isOpen);
                return;
            }
            sidebar?.classList.toggle('collapsed');
        };
        if (sidebarLogo) sidebarLogo.onclick = () => {
            if (window.innerWidth <= 768) {
                setSidebarMobileState(false);
                return;
            }
            toggleSidebar();
        };
        if (headerMenuToggle) headerMenuToggle.onclick = toggleSidebar;
        if (sidebarMobileBackdrop) sidebarMobileBackdrop.onclick = () => setSidebarMobileState(false);
        window.addEventListener('resize', () => {
            if (window.innerWidth > 768) setSidebarMobileState(false);
        });

        if (document.getElementById('closeCreateCourtModal'))
            document.getElementById('closeCreateCourtModal').onclick =
                () => _closeModal('createCourtModal');

        if (document.getElementById('cancelCourtBtn'))
            document.getElementById('cancelCourtBtn').onclick =
                () => _closeModal('createCourtModal');

        const saveCourtBtn = document.getElementById('saveCourtBtn');
        if (saveCourtBtn) saveCourtBtn.onclick = async () => {
            if (window._editingCourtId) {
                const cid = window._editingCourtId;
                const payload = {
                    nome_quadra: document.getElementById('court_nome')?.value || '',
                    rua_quadra: document.getElementById('court_rua')?.value || '',
                    numero_quadra: '',
                    cidade_quadra: document.getElementById('court_cidade')?.value || '',
                    bairro_quadra: document.getElementById('court_bairro')?.value || '',
                    cep_quadra: document.getElementById('court_cep')?.value || '',
                    estado_quadra: document.getElementById('court_estado')?.value || '',
                    superficie: 'Concreto',
                    esporte_quadra: document.getElementById('court_esportes_lista')?.value || 'Futebol',
                    capacidade: parseInt(document.getElementById('court_capacidade')?.value || '0', 10) || 0
                };
                try {
                    const response = await fetch(`/quadra/${cid}`, {
                        method: 'PUT',
                        headers: { 'Content-Type': 'application/json' },
                        credentials: 'include',
                        body: JSON.stringify(payload)
                    });
                    const resultado = await response.json();
                    if (resultado?.success) {
                        window._editingCourtId = null;
                        await _loadServerData();
                        _renderAll();
                        _closeModal('createCourtModal');
                        _showToast('Quadra atualizada!');
                    } else {
                        _showToast(resultado?.message || 'Erro ao atualizar.');
                    }
                } catch (e) {
                    _showToast('Erro de conexão.');
                }
                return;
            }
            const formData = {
                nome_quadra: document.getElementById('court_nome')?.value || "Quadra Sem Nome",
                rua_quadra: document.getElementById('court_rua')?.value || "",
                numero_quadra: document.getElementById('court_numero')?.value || "",
                cidade_quadra: document.getElementById('court_cidade')?.value || "",
                bairro_quadra: document.getElementById('court_bairro')?.value || "",
                cep_quadra: document.getElementById('court_cep')?.value || "",
                estado_quadra: document.getElementById('court_estado')?.value || "",
                superficie: document.getElementById('court_superficie')?.value || "Concreto",
                esporte_quadra: document.getElementById('court_esporte')?.value || "",
                esportes_disponiveis: document.getElementById('court_esportes_lista')?.value || '',
                capacidade: parseInt(document.getElementById('court_capacidade')?.value || "0", 10) || 0,
                preco_30min: Number(document.getElementById('court_valor_30min')?.value || 0),
                disponibilidade: {
                    dias: ['seg','ter','qua','qui','sex','sab','dom'],
                    inicio: document.getElementById('court_seg_inicio')?.value || '08:00',
                    fim: document.getElementById('court_seg_fim')?.value || '18:00'
                },
                weekSchedule: ['seg','ter','qua','qui','sex','sab','dom'].map(d => { const fechado = !!document.getElementById(`court_${d}_fechado`)?.checked; return ({ dia:d, fechado, inicio: fechado ? '' : (document.getElementById(`court_${d}_inicio`)?.value || ''), fim: fechado ? '' : (document.getElementById(`court_${d}_fim`)?.value || '') }); })
            };

            try {
                if (!formData.preco_30min || Number(formData.preco_30min) <= 0) { _showToast('Informe o valor da quadra por 30 minutos.'); return; }
                if (!document.getElementById('court_owner_doc')?.files?.length) { _showToast('Envie foto comprovando propriedade da quadra.'); return; }
                _showToast('Verificando comprovante da quadra...');
                await new Promise(r=>setTimeout(r,2000));
                const response = await fetch("/quadra", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    credentials: 'include',
                    body: JSON.stringify(formData)
                });

                const resultado = await response.json();
                if (!resultado?.success) {
                    _showToast("Erro: " + (resultado?.message || "não foi possível cadastrar a quadra"));
                    return;
                }

                const newCourt = {
                    id: resultado.id_quadra || Date.now(),
                    nome: formData.nome_quadra,
                    cidade: formData.cidade_quadra,
                    bairro: formData.bairro_quadra,
                    rua: formData.rua_quadra,
                    numero: formData.numero_quadra,
                    cep: formData.cep_quadra,
                    estado: formData.estado_quadra,
                    esporte: formData.esporte_quadra,
                    esportes_disponiveis: formData.esportes_disponiveis || formData.esporte_quadra,
                    capacidade: formData.capacidade,
                    preco_30min: formData.preco_30min,
                    ownerId: _state.currentUser.id,
                    ownerName: _state.currentUser.name,
                    tipo: 'Quadra Alugada',
                    disponibilidade: {
                        dias: formData.weekSchedule.filter(w => !w.fechado && w.inicio && w.fim).map(w => w.dia),
                        inicio: formData.weekSchedule.find(w => w.inicio && w.fim)?.inicio || '08:00',
                        fim: formData.weekSchedule.find(w => w.inicio && w.fim)?.fim || '18:00'
                    },
                    weekSchedule: formData.weekSchedule
                };

                _courts.unshift(newCourt);
                _state.userOwnedCourts.unshift(newCourt.id);
                _syncStorage();
                _renderCourts();
                _renderOwnedCourts();
                _closeModal('createCourtModal');
                _showToast("Quadra cadastrada com sucesso!");
            } catch (erro) {
                console.error("Erro na requisição:", erro);
                _showToast("Erro de conexão com o servidor.");
            }
        };
        // Dentro de _setupDOMListeners:
        const cepInput = document.getElementById('sql_cep');
        if (cepInput) {
            // O evento 'blur' dispara quando o usuário sai do campo de texto
            cepInput.addEventListener('blur', (e) => {
                if (e.target.value.length > 0) {
                    _validarEBuscarCEP(e.target.value);
                }
            });
        }

        const sbToggle = document.getElementById('sidebarToggle');
        if (sbToggle) sbToggle.onclick = () => {
            _state.isSidebarCollapsed = !_state.isSidebarCollapsed;
            document.getElementById('sidebar').classList.toggle('collapsed');
        };

        document.querySelectorAll('.nav-link-item[data-view]').forEach(item => {
            item.onclick = () => {
                const view = item.getAttribute('data-view');
                document.querySelectorAll('.viewport-section').forEach(s => s.classList.remove('active'));
                document.querySelectorAll('.nav-link-item').forEach(l => l.classList.remove('active'));
                const target = document.getElementById(`view-${view}`);
                if (target) target.classList.add('active');
                item.classList.add('active');
                _state.currentView = view;

                if (view === 'quadras' && !_state.userCity) {
                    _initGeolocation();
                } else if (view === 'quadras') {
                    _renderCourts();
                }

                if (window.innerWidth <= 768) {
                    document.getElementById('sidebar')?.classList.remove('mobile-open');
                    document.getElementById('sidebarMobileBackdrop')?.classList.remove('active');
                    document.body.classList.remove('sidebar-mobile-open');
                    document.getElementById('headerMenuToggle')?.setAttribute('aria-expanded', 'false');
                }
            };
        });

        const profileMenuTrigger = document.getElementById('profileMenuTrigger');
        if (profileMenuTrigger) {
            profileMenuTrigger.addEventListener('click', (event) => {
                event.stopPropagation();
                _toggleProfileDropdown();
            });
        }
        document.addEventListener('click', (event) => {
            const menu = document.getElementById('profileDropdownMenu');
            if (!menu || menu.contains(event.target) || profileMenuTrigger?.contains(event.target)) return;
            _toggleProfileDropdown(false);
        });
        const openSettingsFromProfile = document.getElementById('openSettingsFromProfile');
        if (openSettingsFromProfile) openSettingsFromProfile.onclick = () => {
            document.querySelectorAll('.viewport-section').forEach(s => s.classList.remove('active'));
            document.querySelectorAll('.nav-link-item').forEach(l => l.classList.remove('active'));
            document.getElementById('view-settings')?.classList.add('active');
            _state.currentView = 'settings';
            _openSettingsPane('profile');
            _toggleProfileDropdown(false);
        };
        const profileInviteUserBtn = document.getElementById('profileInviteUserBtn');
        if (profileInviteUserBtn) profileInviteUserBtn.onclick = () => {
            const sel = document.getElementById('inviteSiteUserSelect');
            _solicitarAmizadeUsuario(Number(sel && sel.value));
        };
        const invitePlayerSearchBtn = document.getElementById('invitePlayerSearchBtn');
        const invitePlayerSearchInput = document.getElementById('invitePlayerSearchInput');
        const runPlayerSearch = async () => {
            const q = (invitePlayerSearchInput && invitePlayerSearchInput.value) || '';
            const box = document.getElementById('invitePlayerSearchResults');
            if (!box) return;
            box.innerHTML = '<p class="participants-empty-text">Buscando...</p>';
            try {
                const r = await fetch(`/api/usuarios?q=${encodeURIComponent(q)}`, { credentials: 'include' });
                const d = r.ok ? await r.json() : {};
                const list = d.usuarios || [];
                box.innerHTML = list.length
                    ? list
                          .map(
                              (u) =>
                                  `<div class="friend-req-row friend-req-row--compact">
              <span>${u.nome_user}</span>
              <button type="button" class="btn-modal-submit" onclick="engine.logic.solicitarAmizadeUsuario(${u.id_usuario})">Pedido amizade</button>
            </div>`
                          )
                          .join("")
                    : '<p class="participants-empty-text">Nenhum jogador encontrado.</p>';
            } catch (_) {
                box.innerHTML = '<p class="participants-empty-text">Erro na busca.</p>';
            }
        };
        if (invitePlayerSearchBtn) invitePlayerSearchBtn.onclick = runPlayerSearch;
        if (invitePlayerSearchInput) invitePlayerSearchInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); runPlayerSearch(); } });
        const profileInviteToEventBtn = document.getElementById('profileInviteToEventBtn');
        if (profileInviteToEventBtn) profileInviteToEventBtn.onclick = async () => {
            const evId = Number(document.getElementById('inviteToEventSelect')?.value);
            const uid = Number(document.getElementById('inviteToEventUserSelect')?.value);
            if (!evId || !uid) { _showToast('Escolha evento e amigo.'); return; }
            try {
                const r = await fetch(`/eventos/${evId}/convidar`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    credentials: 'include',
                    body: JSON.stringify({ usuario_id: uid })
                });
                const d = await r.json();
                if (d.success) { _showToast('Jogador convidado para o evento!'); await _loadServerData(); _renderAll(); _fillInviteToEventSelects(); }
                else _showToast(d.message || 'Falha.');
            } catch (_) { _showToast('Erro de rede.'); }
        };
        const logoutBtn = document.getElementById('logoutBtn');
        if (logoutBtn) logoutBtn.onclick = () => { window.location.href = '/institucional'; };
        const guestPresencaSubmitBtn = document.getElementById('guestPresencaSubmitBtn');
        if (guestPresencaSubmitBtn) guestPresencaSubmitBtn.onclick = _submitGuestPresence;
        const guestPresencaForm = document.getElementById('guestPresencaForm');
        if (guestPresencaForm) guestPresencaForm.addEventListener('submit', (event) => {
            event.preventDefault();
            _submitGuestPresence();
        });

        const openMyCourtsCreateBtn = document.getElementById('openMyCourtsCreateBtn');
        if (openMyCourtsCreateBtn) openMyCourtsCreateBtn.onclick = () => _openModal('createCourtModal');

        document.querySelectorAll('.s-nav-btn[data-pane]').forEach(button => {
            button.addEventListener('click', () => _openSettingsPane(button.getAttribute('data-pane')));
        });
        _openSettingsPane('profile');

        const changePhotoBtn = document.getElementById('changePhotoBtn');
        const settingsPhotoInput = document.getElementById('settingsPhotoInput');
        if (changePhotoBtn && settingsPhotoInput) changePhotoBtn.onclick = () => settingsPhotoInput.click();
        if (settingsPhotoInput) settingsPhotoInput.addEventListener('change', (event) => {
            const file = event.target.files?.[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = () => {
                _state.currentUser.photo = String(reader.result || '');
                _syncStorage();
                _renderProfileVisuals();
                _showToast('Foto do perfil atualizada!');
            };
            reader.readAsDataURL(file);
        });
        const saveProfileSettingsBtn = document.getElementById('saveProfileSettingsBtn');
        if (saveProfileSettingsBtn) saveProfileSettingsBtn.onclick = _saveProfileSettings;
        const savePasswordSettingsBtn = document.getElementById('savePasswordSettingsBtn');
        if (savePasswordSettingsBtn) savePasswordSettingsBtn.onclick = _changePassword;
        const savePreferencesBtn = document.getElementById('savePreferencesBtn');
        if (savePreferencesBtn) savePreferencesBtn.onclick = _savePreferences;
        _renderSettingsValues();

        if (document.getElementById('triggerCreateModal')) document.getElementById('triggerCreateModal').onclick = () => {
            const hid = document.getElementById('sql_edit_event_id');
            if (hid) hid.value = '';
            _openModal('createModal');
            _toggleMenuPaymentFields();
        };
        if (document.getElementById('closeCreateModal')) document.getElementById('closeCreateModal').onclick = () => _closeModal('createModal');
        if (document.getElementById('cancelEventBtn')) document.getElementById('cancelEventBtn').onclick = () => _closeModal('createModal');
        const sqlQuadra = document.getElementById('sql_quadra');
        if (sqlQuadra) sqlQuadra.addEventListener('change', _toggleMenuPaymentFields);
        _toggleMenuPaymentFields();

        if (document.getElementById('closeCreateEventFromCourtModal')) document.getElementById('closeCreateEventFromCourtModal').onclick = () => _closeModal('createEventFromCourtModal');
        if (document.getElementById('cancelEventFromCourtBtn')) document.getElementById('cancelEventFromCourtBtn').onclick = () => _closeModal('createEventFromCourtModal');
        const inviteQrModal = document.getElementById('inviteQrModal');
        if (inviteQrModal) {
            inviteQrModal.addEventListener('click', (event) => {
                if (event.target === inviteQrModal) _closeModal('inviteQrModal');
            });
        }
        const eventCourtQuadra = document.getElementById('event_court_quadra');
        if (eventCourtQuadra) eventCourtQuadra.addEventListener('change', _toggleCourtPaymentFields);

        const filtros = {
            cidade: document.getElementById('filtro_cidade'),
            esporte: document.getElementById('filtro_esporte'),
            faixa: document.getElementById('filtro_faixa'),
            genero: document.getElementById('filtro_genero'),
            data: document.getElementById('filtro_data'),
            buscaLivre: document.getElementById('filtro_busca')
        };

        const applyFilters = () => {
            _state.exploreFilters = {
                cidade: filtros.cidade?.value || '',
                esporte: filtros.esporte?.value || '',
                faixa: filtros.faixa?.value || '',
                genero: filtros.genero?.value || '',
                data: filtros.data?.value || '',
                buscaLivre: filtros.buscaLivre?.value || ''
            };
            _renderExplore();
        };

        const btnAplicar = document.getElementById('btnAplicarFiltros');
        if (btnAplicar) btnAplicar.onclick = applyFilters;

        const btnLimpar = document.getElementById('btnLimparFiltros');
        if (btnLimpar) btnLimpar.onclick = () => {
            Object.values(filtros).forEach(el => { if (el) el.value = ''; });
            _state.exploreFilters = {
                cidade: '',
                esporte: '',
                faixa: '',
                genero: '',
                data: '',
                buscaLivre: ''
            };
            _renderExplore();
        };

        const qFiltros = {
            cidade: document.getElementById('filtro_q_cidade'),
            bairro: document.getElementById('filtro_q_bairro'),
            esporte: document.getElementById('filtro_q_esporte'),
            tipo: document.getElementById('filtro_q_tipo'),
            capacidade: document.getElementById('filtro_q_capacidade')
        };

        const applyCourtFilters = () => {
            _state.courtsFilters = {
                cidade: qFiltros.cidade?.value || '',
                bairro: qFiltros.bairro?.value || '',
                esporte: qFiltros.esporte?.value || '',
                tipo: qFiltros.tipo?.value || '',
                capacidadeMin: qFiltros.capacidade?.value ? Number(qFiltros.capacidade.value) : null
            };
            _renderCourts();
        };

        const btnAplicarQ = document.getElementById('btnAplicarFiltrosQuadra');
        if (btnAplicarQ) btnAplicarQ.onclick = applyCourtFilters;

        const btnLimparQ = document.getElementById('btnLimparFiltrosQuadra');
        if (btnLimparQ) btnLimparQ.onclick = () => {
            Object.values(qFiltros).forEach(el => { if (el) el.value = ''; });
            _state.courtsFilters = {
                cidade: '',
                bairro: '',
                esporte: '',
                tipo: '',
                capacidadeMin: null
            };
            _renderCourts();
        };

        document.querySelectorAll('.sports-tab-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const sport = btn.getAttribute('data-sport-tab');
                document.querySelectorAll('.sports-tab-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');

                document.querySelectorAll('.sports-tab-pane').forEach(pane => pane.classList.remove('active'));
                if (sport === 'futebol') document.getElementById('sportTabFutebol')?.classList.add('active');
                if (sport === 'volei') document.getElementById('sportTabVolei')?.classList.add('active');
                if (sport === 'basquete') document.getElementById('sportTabBasquete')?.classList.add('active');
            });
        });

        // Dentro de _setupDOMListeners no javahomepage.js
        
        const weekDays = ['seg','ter','qua','qui','sex','sab','dom'];
        const weekGrid = document.getElementById('courtWeekSchedule');
        if (weekGrid) {
            weekGrid.innerHTML = weekDays.map(d => `<div class="week-day-row"><strong>${d.toUpperCase()}</strong><label><input type="checkbox" id="court_${d}_fechado"> Fechado</label><input type="time" id="court_${d}_inicio" value="08:00"><input type="time" id="court_${d}_fim" value="18:00"></div>`).join('');
            weekDays.forEach(d => {
                const chk = document.getElementById(`court_${d}_fechado`);
                const ini = document.getElementById(`court_${d}_inicio`);
                const fim = document.getElementById(`court_${d}_fim`);
                if (chk) chk.onchange = () => {
                    const off = !!chk.checked;
                    if (ini) ini.disabled = off;
                    if (fim) fim.disabled = off;
                };
            });
        }

        const saveEventBtnEl = document.getElementById('saveEventBtn');
        if (saveEventBtnEl) saveEventBtnEl.onclick = async () => {
            const tipo = document.getElementById('sql_quadra')?.value || '';
            const isAlugada = (tipo || '').toLowerCase().includes('alugada');
            if (isAlugada) {
                const v = document.getElementById('sql_valor')?.value;
                const b = document.getElementById('sql_banco')?.value;
                const t = document.getElementById('sql_titular')?.value;
                const p = document.getElementById('sql_pix')?.value;
                if (!v || Number(v) <= 0 || !b || !t || !p) {
                    _showToast("Para quadra alugada preencha valor, banco, titular e PIX.");
                    return;
                }
            }
            const editEvId = document.getElementById('sql_edit_event_id')?.value;
            const formData = {
                nome_evento: document.getElementById('sql_nome')?.value || "Evento Arena",
                esporte_evento: document.getElementById('sql_esporte')?.value || "Futebol",
                cidade_evento: document.getElementById('sql_cidade')?.value || "",
                numero_evento: document.getElementById('sql_numero')?.value || "",
                rua_evento: document.getElementById('sql_rua')?.value || "",
                bairro_evento: document.getElementById('sql_bairro')?.value || "",
                data_evento: document.getElementById('sql_data')?.value || "",
                horario_inicio: document.getElementById('sql_inicio')?.value || "",
                horario_termino: document.getElementById('sql_fim')?.value || "",
                descricao_evento: document.getElementById('sql_desc')?.value || "",
                valor_aluguel: document.getElementById('sql_valor')?.value || 0,
                pix: document.getElementById('sql_pix')?.value || "",
                banco: document.getElementById('sql_banco')?.value || "",
                beneficiario: document.getElementById('sql_titular')?.value || "",
                cep_evento: document.getElementById('sql_cep')?.value || "",
                max_vagas: document.getElementById('sql_max')?.value || 10,
                tipo: document.getElementById('sql_quadra')?.value,
                genero: (document.getElementById('sql_genero')?.value || 'misto').toLowerCase(),
                faixa_etaria: document.getElementById('sql_faixa')?.value || 'Livre',
                quadra_id: null,
                creator_participates: !!document.getElementById('sql_creator_participates')?.checked
            };
            if (!formData.data_evento || !formData.horario_inicio || !formData.horario_termino || formData.horario_inicio >= formData.horario_termino) { _showToast('Ajuste data/hora de início e término.'); return; }

            try {
                const url = editEvId ? `/eventos/${editEvId}` : '/eventos';
                const method = editEvId ? 'PUT' : 'POST';
                const response = await fetch(url, {
                    method,
                    headers: { "Content-Type": "application/json" },
                    credentials: 'include',
                    body: JSON.stringify(formData)
                });

                const resultado = await response.json();

                if (resultado.success) {
                    if (document.getElementById('sql_edit_event_id')) document.getElementById('sql_edit_event_id').value = '';
                    _showToast(editEvId ? "Evento atualizado!" : "Evento criado com sucesso!");
                    await _loadServerData();
                    _syncStorage();
                    _renderAll();
                    _closeModal('createModal');
                } else {
                    _showToast("Erro: " + resultado.message);
                }
            } catch (erro) {
                console.error("Erro na requisição:", erro);
                _showToast("Erro de conexão com o servidor.");
            }
        };

        const saveEventFromCourtBtnEl = document.getElementById('saveEventFromCourtBtn');
        if (saveEventFromCourtBtnEl) saveEventFromCourtBtnEl.onclick = async () => {
            const tipo = document.getElementById('event_court_quadra')?.value || '';
            const isAlugada = tipo.toLowerCase().includes('alugada');
            if (isAlugada) {
                const renterName = document.getElementById('event_court_renter_name')?.value?.trim();
                const renterCpf = document.getElementById('event_court_renter_cpf')?.value?.trim();
                const renterDoc = document.getElementById('event_court_renter_doc')?.files?.length;
                if (!renterName || !renterCpf || !renterDoc) { _showToast('Informe nome, CPF e documento do locatário.'); return; }
                _showToast('Verificando documentos do locatário...');
                await new Promise(r=>setTimeout(r,2000));
                const v = document.getElementById('event_court_valor')?.value;
                const p = document.getElementById('event_court_pix')?.value;
                if (!v || !p) {
                    _showToast("Selecione os horários e preencha apenas o PIX do criador do evento.");
                    return;
                }
            }
            const formData = {
                nome_evento: document.getElementById('event_court_nome')?.value || "Evento",
                esporte_evento: document.getElementById('event_court_esporte')?.value || "Futebol",
                cidade_evento: document.getElementById('event_court_cidade')?.value || "",
                numero_evento: document.getElementById('event_court_numero')?.value || "0",
                rua_evento: document.getElementById('event_court_rua')?.value || "",
                bairro_evento: document.getElementById('event_court_bairro')?.value || "",
                data_evento: "",
                horario_inicio: "",
                horario_termino: "",
                descricao_evento: document.getElementById('event_court_desc')?.value || "",
                valor_aluguel: document.getElementById('event_court_valor')?.value || 0,
                pix: document.getElementById('event_court_pix')?.value || "",
                banco: "",
                beneficiario: "",
                cep_evento: document.getElementById('event_court_cep')?.value || "0",
                max_vagas: document.getElementById('event_court_max')?.value || 10,
                tipo: document.getElementById('event_court_quadra')?.value || "Quadra publica",
                quadra_id: document.getElementById('event_court_quadra_id')?.value || null,
                creator_participates: !!document.getElementById('event_court_creator_participates')?.checked
            };
            if (isAlugada) {
                const pickedBtns = Array.from(document.querySelectorAll('#privateCourtSlotsGrid .private-slot.slot-blue'));
                if (!pickedBtns.length) { _showToast('Selecione ao menos 1 horário na grade da quadra.'); return; }
                const days = [...new Set(pickedBtns.map(b => b.dataset.day))];
                if (days.length !== 1) { _showToast('Selecione horários de apenas 1 dia por evento.'); return; }
                const selectedDay = days[0];
                const slots = pickedBtns.map(b => b.dataset.slot).sort();
                const first = slots[0];
                const last = slots[slots.length - 1];
                const endMinutes = _toMinutes(last) + 30;
                const endH = String(Math.floor(endMinutes / 60)).padStart(2, '0');
                const endM = String(endMinutes % 60).padStart(2, '0');
                formData.horario_inicio = first;
                formData.horario_termino = `${endH}:${endM}`;
                formData.data_evento = _nextDateFromDayToken(selectedDay);
                formData._selectedDay = selectedDay;
                formData._selectedSlots = slots;
            } else {
                _showToast('Este fluxo é para quadra privada com seleção de horários.');
                return;
            }
            try {
                const response = await fetch("/eventos", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    credentials: 'include',
                    body: JSON.stringify(formData)
                });
                const resultado = await response.json();
                if (resultado.success) {
                    _showToast("Evento criado com sucesso!");
                    const newEv = {
                        id: resultado.evento_id || Date.now(),
                        nome: formData.nome_evento,
                        data: formData.data_evento,
                        esporte: formData.esporte_evento,
                        cidade: formData.cidade_evento,
                        bairro: formData.bairro_evento,
                        valor: Number(formData.valor_aluguel || 0),
                        pix: formData.pix || '',
                        banco: formData.banco || '',
                        titular: formData.beneficiario || '',
                        ocupadas: 1,
                        max: parseInt(formData.max_vagas) || 10,
                        quadra_id: formData.quadra_id || null,
                        participantes: [_state.currentUser.id], participantNames: { [_state.currentUser.id]: _state.currentUser.name }, creatorId: _state.currentUser.id, creatorName: _state.currentUser.name, players: formData.creator_participates ? [_state.currentUser.id] : [], spectators: formData.creator_participates ? [] : [_state.currentUser.id]
                    };
                    if (isAlugada) {
                        const courtId = formData.quadra_id;
                        const key = `${courtId}_${formData._selectedDay}`;
                        const existing = _state.courtBookings[key] || [];
                        const picked = formData._selectedSlots || [];
                        _state.courtBookings[key] = [...existing.filter(b=>!picked.includes(b.slot)), ...picked.map(slot=>({slot, userId:_state.currentUser.id}))];
                    }
                    _state.events.unshift(newEv);
                    _state.userOwnedEvents = [...new Set([newEv.id, ..._state.userOwnedEvents])];
                    _state.userSubscriptions = [...new Set([newEv.id, ..._state.userSubscriptions])];
                    _syncStorage();
                    _renderAll();
                    _closeModal('createEventFromCourtModal');
                } else {
                    _showToast("Erro: " + (resultado.message || "não foi possível criar o evento."));
                }
            } catch (erro) {
                console.error("Erro na requisição:", erro);
                _showToast("Erro de conexão com o servidor.");
            }
        };
    };

    // --------------------
    // EXPOSIÇÃO DO MÓDULO
    // --------------------
    return {
        init,
        logic: {
            handleSubscription: _handleSubscription,
            leaveEvent: _leaveEvent,
            deleteEvent: _deleteEvent,
            setTheme: _applyTheme,
            abrirLocalizacao: _abrirLocalizacao,
            openEventDetails: _openEventDetails,
            openCourtDetails: _openCourtDetails,
            openInviteQrModal: _openInviteQrModal,
            showPlayerDetails: _showPlayerDetails,
            openCreateEventFromCourt: _openCreateEventFromCourt,
            shareEvent: _shareEvent,
            finalizeEventResult: _finalizeEventResult,
            invitePlayerToEvent: _invitePlayerToEvent,
            toggleRole: _toggleRole,
            removeFromEvent: _removeFromEvent,
            openEditEvent: _openEditEvent,
            openEditCourt: _openEditCourt,
            deleteCourt: _deleteCourt,
            aceitarAmizade: _aceitarAmizade,
            recusarAmizade: _recusarAmizade,
            verPerfil: _verPerfil,
            solicitarAmizadeUsuario: _solicitarAmizadeUsuario,
            openGuestPresenceModal: _openGuestPresenceModal
        },
        ui: {
            openModal: _openModal,
            closeModal: _closeModal,
            openModalWithData: _openModalWithData,
            deleteSport: _deleteSport,
            goToView: (view) => {
                const target = document.querySelector(`.nav-link-item[data-view="${view}"]`);
                if (target) target.click();
            }
        }
    };

}
    )();
    window.deleteSport = function (id) { return window.engine.ui.deleteSport(id); };
    isReady().then(() => window.engine.init().catch(err => console.error("Erro na inicialização:", err)));
})();
