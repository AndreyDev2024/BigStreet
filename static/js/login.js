console.log("JS carregado");

function showBigStreetMessage(text, type = "default") {
    let container = document.getElementById("message-container");

    if (!container) {
        container = document.createElement("div");
        container.id = "message-container";
        document.body.prepend(container);
    }

    const card = document.createElement("div");
    card.classList.add("bigstreet-card");

    if (type === "success") card.classList.add("bigstreet-success");
    if (type === "error") card.classList.add("bigstreet-error");

    card.innerText = text;
    container.appendChild(card);

    setTimeout(() => {
        card.style.opacity = "0";
        card.style.transform = "translateY(-10px)";
        setTimeout(() => card.remove(), 300);
    }, 4000);
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

document.addEventListener("DOMContentLoaded", () => {
    const form = document.getElementById("formAuth");
    const emailInput = document.getElementById("email");
    const passwordInput = document.getElementById("senha");

    const forgotPasswordBtn = document.getElementById("forgotPasswordBtn");
    const forgotPasswordModal = document.getElementById("forgotPasswordModal");
    const cancelForgotPasswordBtn = document.getElementById("cancelForgotPasswordBtn");
    const forgotPasswordForm = document.getElementById("forgotPasswordForm");
    const forgotPasswordTitle = document.getElementById("forgotPasswordTitle");
    const forgotPasswordDescription = document.getElementById("forgotPasswordDescription");
    const sendRecoveryCodeBtn = document.getElementById("sendRecoveryCodeBtn");
    const confirmRecoveryCodeBtn = document.getElementById("confirmRecoveryCodeBtn");
    const backToEmailStepBtn = document.getElementById("backToEmailStepBtn");
    const backToCodeStepBtn = document.getElementById("backToCodeStepBtn");
    const forgotEmail = document.getElementById("forgotEmail");
    const forgotCode = document.getElementById("forgotCode");
    const forgotNewPassword = document.getElementById("forgotNewPassword");
    const forgotConfirmPassword = document.getElementById("forgotConfirmPassword");

    const forgotState = {
        email: "",
        step: "email"
    };

    const updateForgotPasswordStep = (step) => {
        forgotState.step = step;

        document.querySelectorAll(".forgot-step").forEach((section) => {
            section.classList.toggle("active", section.getAttribute("data-step") === step);
        });

        if (!forgotPasswordTitle || !forgotPasswordDescription) return;

        if (step === "email") {
            forgotPasswordTitle.textContent = "Recuperar acesso";
            forgotPasswordDescription.textContent = "Informe seu e-mail para enviarmos um codigo de confirmacao.";
            return;
        }

        if (step === "code") {
            forgotPasswordTitle.textContent = "Confirmar codigo";
            forgotPasswordDescription.textContent = "Digite o codigo de 6 digitos enviado para o e-mail informado.";
            return;
        }

        forgotPasswordTitle.textContent = "Atualizar senha";
        forgotPasswordDescription.textContent = "Codigo confirmado. Agora escolha sua nova senha.";
    };

    const resetForgotPasswordFlow = () => {
        forgotState.email = "";
        forgotState.step = "email";
        forgotPasswordForm?.reset();
        updateForgotPasswordStep("email");
    };

    const toggleForgotPasswordModal = (open) => {
        if (!forgotPasswordModal) return;
        forgotPasswordModal.classList.toggle("active", open);
        if (!open) resetForgotPasswordFlow();
    };

    setupPasswordToggles();
    updateForgotPasswordStep("email");

    form?.addEventListener("submit", async (event) => {
        event.preventDefault();

        const email = emailInput?.value.trim() || "";
        const senha = passwordInput?.value || "";

        if (!email || !senha) {
            showBigStreetMessage("Preencha todos os campos.", "error");
            return;
        }

        try {
            const response = await fetch("/auth", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    acao: "login",
                    email,
                    senha
                })
            });

            const resultado = await response.json();

            if (response.ok && resultado.success) {
                showBigStreetMessage("Login autorizado.", "success");
                window.location.href = "/home";
                return;
            }

            showBigStreetMessage(resultado.message || "Credenciais invalidas.", "error");
        } catch (error) {
            console.error("Erro:", error);
            showBigStreetMessage("Erro ao conectar com o servidor.", "error");
        }
    });

    forgotPasswordBtn?.addEventListener("click", () => {
        const email = emailInput?.value.trim() || "";
        if (forgotEmail) forgotEmail.value = email;
        forgotState.email = email;
        updateForgotPasswordStep("email");
        toggleForgotPasswordModal(true);
    });

    cancelForgotPasswordBtn?.addEventListener("click", () => toggleForgotPasswordModal(false));

    forgotPasswordModal?.addEventListener("click", (event) => {
        if (event.target === forgotPasswordModal) {
            toggleForgotPasswordModal(false);
        }
    });

    forgotPasswordForm?.addEventListener("submit", async (event) => {
        event.preventDefault();

        const email = forgotState.email || forgotEmail?.value.trim() || "";
        const novaSenha = forgotNewPassword?.value || "";
        const confirmarSenha = forgotConfirmPassword?.value || "";
        const codigo = forgotCode?.value.trim() || "";

        if (!email || !novaSenha || !confirmarSenha) {
            showBigStreetMessage("Preencha todos os campos para redefinir a senha.", "error");
            return;
        }

        if (novaSenha.length < 6) {
            showBigStreetMessage("A nova senha deve ter pelo menos 6 caracteres.", "error");
            return;
        }

        if (novaSenha !== confirmarSenha) {
            showBigStreetMessage("A confirmacao da senha nao confere.", "error");
            return;
        }

        try {
            const response = await fetch("/auth", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    acao: "recuperar_senha",
                    email,
                    nova_senha: novaSenha,
                    codigo
                })
            });

            const resultado = await response.json();

            if (response.ok && resultado.success) {
                showBigStreetMessage("Senha atualizada com sucesso.", "success");
                if (passwordInput) passwordInput.value = "";
                toggleForgotPasswordModal(false);
                return;
            }

            showBigStreetMessage(resultado.message || "Nao foi possivel redefinir a senha.", "error");
        } catch (error) {
            console.error("Erro:", error);
            showBigStreetMessage("Erro ao conectar durante a redefinicao da senha.", "error");
        }
    });

    sendRecoveryCodeBtn?.addEventListener("click", async () => {
        const email = forgotEmail?.value.trim() || "";

        if (!email) {
            showBigStreetMessage("Informe seu e-mail para receber o codigo.", "error");
            return;
        }

        try {
            const response = await fetch("/auth", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    acao: "solicitar_recuperacao",
                    email
                })
            });

            const resultado = await response.json();

            if (response.ok && resultado.success) {
                forgotState.email = email;
                updateForgotPasswordStep("code");
                const codigoTeste = resultado.codigo_teste ? ` Codigo para teste local: ${resultado.codigo_teste}` : "";
                showBigStreetMessage((resultado.message || "Codigo enviado com sucesso.") + codigoTeste, "success");
                return;
            }

            showBigStreetMessage(resultado.message || "Nao foi possivel enviar o codigo.", "error");
        } catch (error) {
            console.error("Erro:", error);
            showBigStreetMessage("Erro ao solicitar o codigo de recuperacao.", "error");
        }
    });

    confirmRecoveryCodeBtn?.addEventListener("click", async () => {
        const email = forgotState.email || forgotEmail?.value.trim() || "";
        const codigo = forgotCode?.value.trim() || "";

        if (!email || !codigo) {
            showBigStreetMessage("Informe o codigo recebido para continuar.", "error");
            return;
        }

        try {
            const response = await fetch("/auth", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    acao: "validar_codigo_recuperacao",
                    email,
                    codigo
                })
            });

            const resultado = await response.json();

            if (response.ok && resultado.success) {
                updateForgotPasswordStep("password");
                showBigStreetMessage("Codigo confirmado. Agora voce ja pode atualizar a senha.", "success");
                return;
            }

            showBigStreetMessage(resultado.message || "Codigo invalido.", "error");
        } catch (error) {
            console.error("Erro:", error);
            showBigStreetMessage("Erro ao validar o codigo de recuperacao.", "error");
        }
    });

    backToEmailStepBtn?.addEventListener("click", () => updateForgotPasswordStep("email"));
    backToCodeStepBtn?.addEventListener("click", () => updateForgotPasswordStep("code"));
});
