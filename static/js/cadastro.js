console.log("JS carregado");
const isCadastro = window.location.pathname.includes("/cadastro");

// --- FUNÇÕES UTILITÁRIAS ---
window.soNumeros = function (input, limite) {
    input.value = input.value.replace(/\D/g, '');
    if (input.value.length > limite) input.value = input.value.slice(0, limite);
}

const campoData = document.getElementById("dataNasc");
if (campoData) {
    campoData.setAttribute("max", new Date().toISOString().split("T")[0]);
}

function validarSenha(senha) {
    const regex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).{8,}$/;
    return regex.test(senha);
}

function formatDate(s) {
    return new Date(s).toLocaleDateString('pt-BR');
}

function setupPasswordToggles() {
    document.querySelectorAll(".password-toggle").forEach((button) => {
        button.addEventListener("click", () => {
            const targetId = button.getAttribute("data-target");
            const input = targetId ? document.getElementById(targetId) : null;
            if (!input) return;

            const shouldShowPassword = input.type === "password";
            input.type = shouldShowPassword ? "text" : "password";
            button.setAttribute("aria-pressed", String(shouldShowPassword));
            button.setAttribute("aria-label", shouldShowPassword ? "Ocultar senha" : "Mostrar senha");
        });
    });
}

// --- LÓGICA DE INTERFACE E EVENTOS ---
document.addEventListener('DOMContentLoaded', () => {
    // Variáveis de Estado
    let users = [{ id: "000000001", nick: "Admin", name: "Administrador", email: "admin@gmail.com", pass: "Admin@123", reputation: { pos: 10, neg: 0, miss: 0 }, city: "São Paulo", state: "SP", friends: [], avatar: null }];
    let currentUser = null;
    let events = [];
    let fakeUserDatabase = {};
    let privateChats = {};
    const formAuth = document.getElementById("formAuth");
    const fakeNames = ["Carlos S.", "Pedro H.", "Ana M.", "João V.", "Lucas D."];

    // Inicialização
    setupPasswordToggles();
    generateEvents();
    updateHeaderUI();

    if (document.getElementById('carousel-highlights')) {
        generateEvents();
        renderHome();
    }



    // --- FORMULÁRIO DE AUTENTICAÇÃO (CADASTRO/LOGIN) ---
    if (formAuth) {
        formAuth.addEventListener("submit", async function (e) {
            e.preventDefault();
            console.log("Submit funcionando");

            const dados = {
                email: document.getElementById("email").value.trim(),
                senha: document.getElementById("senha").value,
                acao: isCadastro ? 'cadastro' : 'login'
            };

            if (isCadastro) {
                if (!validarSenha(dados.senha)) {
                    showBigStreetMessage("A senha não cumpre os requisitos de segurança. 1 numero; 1 letra maiuscula; 1 letra minuscula; 1 caractere especial", "error");
                    return;
                }
                dados.nome_user = document.getElementById("nome").value.trim();
                dados.cpf = document.getElementById("cpf").value;
                dados.data_nascimento = document.getElementById("dataNasc").value;
                dados.peso = document.getElementById("peso").value || null;
                dados.altura = document.getElementById("altura").value || null;
                dados.cep = document.getElementById("cep").value || null;
                dados.uf_user = document.getElementById("estado").value;
                dados.cidade_user = document.getElementById("cidade").value;
                dados.rua_user = document.getElementById("rua").value;
                dados.bairro_user = document.getElementById("bairro").value;
            }

            try {
                const response = await fetch("/auth", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(dados)
                });

                const resultado = await response.json();

                if (resultado.success) {
                    showBigStreetMessage(isCadastro ? "Cadastro realizado!" : "Login realizado!", "success");
                    if (isCadastro) {
                        window.location.href = "/login";
                    } else {
                        // Simulação de sessão após login bem-sucedido no banco
                        currentUser = { nick: dados.email.split('@')[0], email: dados.email };
                        updateHeaderUI();
                        navigate('home');
                    }
                } else {
                    showBigStreetMessage(resultado.message || "Erro no cadastro/login.", "error");
                }
            } catch (error) {
                console.error("Erro de conexão:", error);
                showBigStreetMessage("Servidor offline. Verifique o backend na porta 5000.", "error");
            }
        });
    }

    // --- SISTEMA DE EVENTOS ---
    function generateEvents() {
        const cities = [{ city: "São Paulo", state: "SP" }, { city: "Rio de Janeiro", state: "RJ" }];
        const sports = ["Futebol", "Basquete", "Vôlei"];

        for (let i = 0; i < 10; i++) {
            events.push({
                id: i + 1,
                name: `${sports[i % 3]} de Domingo`,
                sport: sports[i % 3],
                city: cities[i % 2].city,
                state: cities[i % 2].state,
                date: "2024-12-20",
                time: "18:00",
                location: "Quadra Central",
                current: 2,
                max: 10,
                status: 'aberto',
                owner: "Admin",
                participants: ["Admin", "Carlos S."],
                type: 'public',
                chatMessages: []
            });
        }
    }

    window.renderHome = function () {
        const container = document.getElementById('carousel-highlights');
        if (container) {
            container.innerHTML = events.map(createCard).join('');
        }
    };

    function createCard(evt) {
        return `
            <div class="event-card" onclick="openDetails(${evt.id})">
                <div class="event-title">${evt.name}</div>
                <div class="event-info">
                    <i class="fas fa-map-marker-alt"></i> ${evt.city} - ${evt.state}<br>
                    <i class="far fa-calendar"></i> ${formatDate(evt.date)} às ${evt.time}
                </div>
                <div class="card-footer">
                    <span><i class="fas fa-users"></i> ${evt.current}/${evt.max}</span>
                    <button class="btn-join">Ver Detalhes</button>
                </div>
            </div>`;
    }

    window.openCreateModal = function () {
        if (!currentUser) {
            showBigStreetMessage("Faça login para criar eventos", "error");
            return;
        }
        openModal("createModal");
    };

    const createForm = document.getElementById("createEventForm");
    if (createForm) {
        createForm.addEventListener("submit", e => {
            e.preventDefault();
            const evt = {
                id: Date.now(),
                name: document.getElementById("evtName").value,
                owner: currentUser.nick,
                city: document.getElementById("evtCity").value,
                state: document.getElementById("evtState").value,
                max: document.getElementById("evtMax").value,
                current: 1,
                participants: [currentUser.nick],
                status: "aberto",
                sport: document.getElementById("evtSport").value,
                date: document.getElementById("evtDate").value,
                time: document.getElementById("evtTime").value,
                location: document.getElementById("evtLocation").value,
                type: 'public',
                chatMessages: []
            };
            events.unshift(evt);
            closeModal("createModal");
            renderHome();
        });
    }

    // --- UI E NAVEGAÇÃO ---
    function updateHeaderUI() {
        const c = document.getElementById('authContainer');
        if (!c) return;
        if (currentUser) {
            c.innerHTML = `<span class="user-logged">Olá, ${currentUser.nick}</span> 
                           <button onclick="logout()" class="auth-btn">Sair</button>`;
        } else {
            c.innerHTML = `<button class="auth-btn" onclick="navigate('login')">Login / Cadastro</button>`;
        }
    }

    window.logout = function () {
        currentUser = null;
        updateHeaderUI();
        showBigStreetMessage("Sessão encerrada.", "success");
    };

    window.openModal = id => document.getElementById(id)?.classList.add('active');
    window.closeModal = id => document.getElementById(id)?.classList.remove('active');

    window.navigate = function (to) {
        if (to === 'login') window.location.href = "/login";
        // Adicione outras rotas conforme necessário
    };
});
function showBigStreetMessage(text, type = "default") {
    let container = document.getElementById("message-container");

    // Se o container não existir no HTML, ele cria um agora
    if (!container) {
        container = document.createElement("div");
        container.id = "message-container";
        document.body.prepend(container);
    }

    const card = document.createElement("div");
    card.classList.add("bigstreet-card");

    // Define a cor baseada no tipo
    if (type === "success") card.classList.add("bigstreet-success");
    if (type === "error") card.classList.add("bigstreet-error");

    card.innerText = text;
    container.appendChild(card);

    // Remove a mensagem após 4 segundos com efeito de sumiço
    setTimeout(() => {
        card.style.opacity = "0";
        card.style.transform = "translateY(-10px)";
        setTimeout(() => card.remove(), 300);
    }, 4000);
}
