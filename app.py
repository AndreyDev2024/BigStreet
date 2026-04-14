import mysql.connector
import os
from datetime import datetime
import random
from flask import session
from flask import Flask, request, jsonify, render_template, redirect
from flask_cors import CORS
from data_base import conectar_banco
import requests
import urllib.parse
import json

app = Flask(__name__)

CORS(app, supports_credentials=True, origins=["http://127.0.0.1:5500", "http://localhost:5500", "http://127.0.0.1:5000", "http://localhost:5000"])
app.secret_key = os.urandom(24)
app.config["SESSION_COOKIE_SAMESITE"] = "Lax"
app.config["SESSION_COOKIE_HTTPONLY"] = True

SPORTS_POSITIONS = {
    "Volei": ["Levantador", "Oposto", "Central", "Ponta", "Líbero"],
    "Futebol": ["Goleiro", "Zagueiro", "Lateral", "Meio-campo", "Atacante"],
    "Basquete": ["Armador", "Ala-armador", "Ala", "Ala-pivô", "Pivô"],
    "Tenis": ["Simples", "Duplas"],
    "Corrida": []
}

RUNTIME_SCHEMA_READY = False

def _serialize_dt(val):
    if val is None:
        return None
    if hasattr(val, "strftime"):
        return val.strftime("%Y-%m-%d %H:%M:%S")
    return str(val)


def _evento_fim_datetime(row):
    """Retorna datetime de término do evento (combina data_evento + horario_termino se necessário)."""
    try:
        ht = row.get("horario_termino")
        if ht is None:
            return None
        hs = _serialize_dt(ht) if hasattr(ht, "strftime") else str(ht).strip()
        if len(hs) >= 19 and hs[4] == "-" and " " in hs:
            return datetime.strptime(hs[:19], "%Y-%m-%d %H:%M:%S")
        de = row.get("data_evento")
        if de is None:
            return None
        ds = de.strftime("%Y-%m-%d") if hasattr(de, "strftime") else str(de)[:10]
        tpart = hs.split()[-1] if " " in hs else hs
        if len(tpart) == 5:
            tpart = tpart + ":00"
        return datetime.strptime(f"{ds} {tpart[:8]}", "%Y-%m-%d %H:%M:%S")
    except (ValueError, TypeError, IndexError):
        return None


def _evento_finalizado(row):
    fim = _evento_fim_datetime(row)
    if fim is None:
        return False
    return datetime.now() >= fim


def _table_exists(cursor, name: str) -> bool:
    cursor.execute(
        "SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = %s",
        (name,),
    )
    return cursor.fetchone() is not None


def _current_user_id(require=False):
    uid = session.get("usuario_id")
    if require and not uid:
        return None
    return uid


def _get_table_columns(cursor, table_name: str):
    """Retorna um set com as colunas existentes na tabela (schema atual do banco)."""
    cursor.execute(
        """
        SELECT COLUMN_NAME
        FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME = %s
        """,
        (table_name,),
    )
    cols = set()
    for row in cursor.fetchall():
        if isinstance(row, dict):
            cols.add(next(iter(row.values())))
        else:
            cols.add(row[0])
    return cols


def _digits_only(value):
    return "".join(ch for ch in str(value or "") if ch.isdigit())


def _as_int(value):
    try:
        if value in (None, ""):
            return None
        return int(str(value).strip())
    except (TypeError, ValueError):
        return None


def _as_float(value):
    try:
        if value in (None, ""):
            return None
        return float(str(value).replace(",", ".").strip())
    except (TypeError, ValueError):
        return None


def _ensure_runtime_schema(force=False):
    global RUNTIME_SCHEMA_READY
    if RUNTIME_SCHEMA_READY and not force:
        return

    db = conectar_banco()
    if db is None:
        return

    cursor = db.cursor()
    changed = False
    try:
        if _table_exists(cursor, "eventos"):
            event_cols = _get_table_columns(cursor, "eventos")
            if "latitude_evento" not in event_cols:
                cursor.execute(
                    "ALTER TABLE eventos ADD COLUMN latitude_evento DECIMAL(11,8) NULL AFTER cep_evento"
                )
                changed = True
                event_cols.add("latitude_evento")
            if "longitude_evento" not in event_cols:
                cursor.execute(
                    "ALTER TABLE eventos ADD COLUMN longitude_evento DECIMAL(11,8) NULL AFTER latitude_evento"
                )
                changed = True

        if not _table_exists(cursor, "evento_participantes_guest"):
            cursor.execute(
                """
                CREATE TABLE evento_participantes_guest (
                    id_guest INT PRIMARY KEY AUTO_INCREMENT,
                    id_evento INT NOT NULL,
                    nome_guest VARCHAR(100) NOT NULL,
                    nome VARCHAR(100) NULL,
                    cpf BIGINT NULL,
                    idade INT NULL,
                    peso FLOAT NULL,
                    altura FLOAT NULL,
                    data_inscricao TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
                    CONSTRAINT fk_evento_participantes_guest_evento
                        FOREIGN KEY (id_evento) REFERENCES eventos(id_evento)
                        ON DELETE CASCADE
                )
                """
            )
            changed = True
        else:
            guest_cols = _get_table_columns(cursor, "evento_participantes_guest")
            for col_name, col_sql in (
                ("nome", "ALTER TABLE evento_participantes_guest ADD COLUMN nome VARCHAR(100) NULL AFTER nome_guest"),
                ("cpf", "ALTER TABLE evento_participantes_guest ADD COLUMN cpf BIGINT NULL AFTER nome"),
                ("idade", "ALTER TABLE evento_participantes_guest ADD COLUMN idade INT NULL AFTER cpf"),
                ("peso", "ALTER TABLE evento_participantes_guest ADD COLUMN peso FLOAT NULL AFTER idade"),
                ("altura", "ALTER TABLE evento_participantes_guest ADD COLUMN altura FLOAT NULL AFTER peso"),
            ):
                if col_name not in guest_cols:
                    cursor.execute(col_sql)
                    changed = True
                    guest_cols.add(col_name)

            if "nome" in guest_cols and "nome_guest" in guest_cols:
                cursor.execute(
                    """
                    UPDATE evento_participantes_guest
                       SET nome = COALESCE(NULLIF(nome, ''), nome_guest)
                     WHERE (nome IS NULL OR nome = '')
                       AND nome_guest IS NOT NULL
                    """
                )
                changed = changed or cursor.rowcount > 0

        if not _table_exists(cursor, "jogador_reports"):
            cursor.execute(
                """
                CREATE TABLE jogador_reports (
                    id_report INT PRIMARY KEY AUTO_INCREMENT,
                    reporter_id INT NOT NULL,
                    reported_user_id INT NOT NULL,
                    id_evento INT NOT NULL,
                    criado_em TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
                    CONSTRAINT uq_jogador_report_evento UNIQUE (reporter_id, reported_user_id, id_evento),
                    CONSTRAINT fk_jogador_report_reporter
                        FOREIGN KEY (reporter_id) REFERENCES usuario(id_usuario)
                        ON DELETE CASCADE,
                    CONSTRAINT fk_jogador_report_reported
                        FOREIGN KEY (reported_user_id) REFERENCES usuario(id_usuario)
                        ON DELETE CASCADE,
                    CONSTRAINT fk_jogador_report_evento
                        FOREIGN KEY (id_evento) REFERENCES eventos(id_evento)
                        ON DELETE CASCADE
                )
                """
            )
            changed = True

        if changed:
            db.commit()
        RUNTIME_SCHEMA_READY = True
    except mysql.connector.Error:
        db.rollback()
        raise
    finally:
        cursor.close()
        db.close()

def _resolve_event_participantes_schema(cursor):
    if not _table_exists(cursor, "evento_participantes"):
        return None
    cols = _get_table_columns(cursor, "evento_participantes")
    user_col = "usuario_id" if "usuario_id" in cols else "id_usuario" if "id_usuario" in cols else None
    papel_col = "papel" if "papel" in cols else None
    return {
        "cols": sorted(cols),
        "user_col": user_col,
        "papel_col": papel_col,
    }


def _resolve_guest_participantes_schema(cursor):
    if not _table_exists(cursor, "evento_participantes_guest"):
        return None
    cols = _get_table_columns(cursor, "evento_participantes_guest")
    name_col = "nome_guest" if "nome_guest" in cols else "nome" if "nome" in cols else None
    id_col = "id_guest" if "id_guest" in cols else "id" if "id" in cols else None
    created_col = "data_inscricao" if "data_inscricao" in cols else "criado_em" if "criado_em" in cols else None
    return {
        "cols": sorted(cols),
        "id_col": id_col,
        "name_col": name_col,
        "created_col": created_col,
        "cpf_col": "cpf" if "cpf" in cols else None,
        "idade_col": "idade" if "idade" in cols else None,
        "peso_col": "peso" if "peso" in cols else None,
        "altura_col": "altura" if "altura" in cols else None,
    }


def _event_participant_exists(cursor, event_id: int, user_id: int) -> bool:
    schema = _resolve_event_participantes_schema(cursor)
    if not schema or not schema.get("user_col"):
        return False
    cursor.execute(
        f"SELECT 1 FROM evento_participantes WHERE id_evento=%s AND {schema['user_col']}=%s LIMIT 1",
        (event_id, user_id),
    )
    return cursor.fetchone() is not None


def _insert_event_participant(db, event_id: int, user_id: int, papel: str = "jogador"):
    cursor = db.cursor()
    schema = _resolve_event_participantes_schema(cursor)
    if not schema or not schema.get("user_col"):
        cursor.close()
        raise mysql.connector.Error(msg="Tabela evento_participantes sem coluna de usuário reconhecida.")
    cols = ["id_evento", schema["user_col"]]
    vals = [event_id, user_id]
    if schema.get("papel_col"):
        cols.append(schema["papel_col"])
        vals.append(papel)
    placeholders = ", ".join(["%s"] * len(cols))
    cursor.execute(
        f"INSERT INTO evento_participantes ({', '.join(cols)}) VALUES ({placeholders})",
        tuple(vals),
    )
    cursor.close()


def _count_event_confirmados(cursor, event_id: int) -> int:
    total = 0
    schema = _resolve_event_participantes_schema(cursor)
    if schema and schema.get("user_col"):
        cursor.execute("SELECT COUNT(*) AS c FROM evento_participantes WHERE id_evento=%s", (event_id,))
        row = cursor.fetchone()
        total += int((row or {}).get("c", 0) if isinstance(row, dict) else row[0] if row else 0)
    guest_schema = _resolve_guest_participantes_schema(cursor)
    if guest_schema:
        cursor.execute("SELECT COUNT(*) AS c FROM evento_participantes_guest WHERE id_evento=%s", (event_id,))
        row = cursor.fetchone()
        total += int((row or {}).get("c", 0) if isinstance(row, dict) else row[0] if row else 0)
    return total


def _clamp_reputation(value) -> float:
    try:
        return round(max(0.0, min(5.0, float(value))), 2)
    except (TypeError, ValueError):
        return 5.0


def _get_user_reputation_snapshot(cursor, user_id: int, persist: bool = False, history_limit: int = 5):
    target_id = _as_int(user_id)
    empty_snapshot = {
        "reputacao_partidas": 5.0,
        "jogos_limpos": 0,
        "reports_recebidos": 0,
        "partidas_reputacao": 0,
        "historico_reputacao": [],
    }
    if not target_id:
        return empty_snapshot

    reports_by_event = {}
    total_reports = 0
    if _table_exists(cursor, "jogador_reports"):
        cursor.execute(
            """
            SELECT id_evento, COUNT(*) AS total
              FROM jogador_reports
             WHERE reported_user_id=%s
             GROUP BY id_evento
            """,
            (target_id,),
        )
        for row in cursor.fetchall() or []:
            event_id = int(row.get("id_evento") or 0) if isinstance(row, dict) else int(row[0] or 0)
            reports = int(row.get("total") or 0) if isinstance(row, dict) else int(row[1] or 0)
            if event_id > 0:
                reports_by_event[event_id] = reports
                total_reports += reports

    finalized_games = []
    schema = _resolve_event_participantes_schema(cursor)
    if schema and schema.get("user_col"):
        cursor.execute(
            f"""
            SELECT DISTINCT e.id_evento,
                   COALESCE(e.nome_evento, CONCAT('Evento ', e.id_evento)) AS nome_evento,
                   e.data_evento,
                   e.horario_termino
              FROM evento_participantes ep
              JOIN eventos e ON e.id_evento = ep.id_evento
             WHERE ep.{schema['user_col']}=%s
             ORDER BY e.data_evento DESC, e.horario_termino DESC
            """,
            (target_id,),
        )
        seen_event_ids = set()
        for row in cursor.fetchall() or []:
            event_id = int(row.get("id_evento") or 0) if isinstance(row, dict) else int(row[0] or 0)
            if event_id <= 0 or event_id in seen_event_ids or not _evento_finalizado(row):
                continue
            seen_event_ids.add(event_id)
            data_evento = row.get("data_evento") if isinstance(row, dict) else row[2]
            data_iso = data_evento.strftime("%Y-%m-%d") if hasattr(data_evento, "strftime") else (str(data_evento)[:10] if data_evento else "")
            denuncias = int(reports_by_event.get(event_id, 0))
            finalized_games.append(
                {
                    "id_evento": event_id,
                    "nome": row.get("nome_evento") if isinstance(row, dict) else row[1],
                    "data": data_iso,
                    "denuncias": denuncias,
                    "reportado": denuncias > 0,
                    "jogo_limpo": denuncias == 0,
                }
            )

    finalized_games.sort(key=lambda item: item.get("data") or "", reverse=True)
    jogos_limpos = sum(1 for jogo in finalized_games if int(jogo.get("denuncias") or 0) == 0)
    reputacao = _clamp_reputation(5.0 + (jogos_limpos * 0.05) - (total_reports * 0.5))

    if persist:
        try:
            cursor.execute(
                "UPDATE usuario SET reputacao_partidas=%s WHERE id_usuario=%s",
                (reputacao, target_id),
            )
        except mysql.connector.Error:
            pass

    return {
        "reputacao_partidas": reputacao,
        "jogos_limpos": int(jogos_limpos),
        "reports_recebidos": int(total_reports),
        "partidas_reputacao": int(len(finalized_games)),
        "historico_reputacao": finalized_games[: max(0, int(history_limit or 0))],
    }


def _guest_presence_event_ids():
    raw_ids = session.get("guest_presence_events") or []
    out = set()
    for item in raw_ids:
        val = _as_int(item)
        if val:
            out.add(val)
    return out


def _mark_guest_presence_event(event_id: int):
    ids = sorted(_guest_presence_event_ids() | {int(event_id)})
    session["guest_presence_events"] = ids
    session.modified = True


def _render_homepage(selected_event_id=None, is_guest=False):
    selected_id = _as_int(selected_event_id)
    return render_template(
        "htmlhomepage.html",
        usuario_logado=bool(session.get("usuario_id")),
        is_guest=bool(is_guest),
        selected_event_id=selected_id,
        guest_presence_confirmed=selected_id in _guest_presence_event_ids() if selected_id else False,
    )

def obter_coordenadas(endereco):
    url = "https://nominatim.openstreetmap.org/search"
    params = {"q": endereco, "format": "json"}

    response = requests.get(
        url,
        params=params,
        headers={"User-Agent": "BigStreetApp"}
    )

    dados = response.json()

    if dados:
        return dados[0]["lat"], dados[0]["lon"]

    return None, None

@app.route("/")
def home():
    return render_template("institucional.html")

@app.route("/login")
def login():
    return render_template("login.html")

@app.route("/cadastro")
def cadastro():
    return render_template("cadastro.html")

@app.route("/home")
def homepage():
    invite_event_id = request.args.get("id_evento", type=int) or request.args.get("invite_event", type=int)
    is_guest = bool(invite_event_id and not session.get("usuario_id"))
    return _render_homepage(selected_event_id=invite_event_id, is_guest=is_guest)


@app.route("/evento/<int:id_evento>")
def homepage_evento(id_evento):
    db = conectar_banco()
    if db is not None:
        cursor = db.cursor()
        try:
            cursor.execute("SELECT 1 FROM eventos WHERE id_evento=%s", (id_evento,))
            if cursor.fetchone() is None:
                return redirect("/home")
        finally:
            cursor.close()
            db.close()
    return _render_homepage(selected_event_id=id_evento, is_guest=not bool(session.get("usuario_id")))

@app.route('/api/public-base-url', methods=['GET'])
def public_base_url():
    """
    Retorna a URL pública da aplicação (ex.: ngrok) para montar links de convite.
    Configure via variável de ambiente PUBLIC_BASE_URL.
    """
    public_url = "https://unvibrational-astrally-glynis.ngrok-free.dev"
    if public_url.endswith("/"):
        public_url = public_url[:-1]
    return jsonify({
        "success": True,
        "public_base_url": public_url
    })

@app.route('/institucional')
def institucional():
    return render_template('institucional.html')



@app.route('/auth', methods=['POST'])


def autenticacao():

    db = conectar_banco()
    if db is None:
        return jsonify({"success": False, "message": "Erro conexão banco"}), 500

    cursor = db.cursor(dictionary=True)
    dados = request.get_json()
    if not dados:
        cursor.close()
        db.close()
        return jsonify({"success": False, "message": "Dados não recebidos"}), 400

    email = dados.get("email")
    senha = dados.get("senha")
    acao = dados.get("acao")

    # ---------------- LOGIN ---------------- #
    if acao == "login":

        cursor.execute("SELECT * FROM usuario WHERE email=%s", (email,))
        usuario = cursor.fetchone()

        if not usuario:
            cursor.close()
            db.close()
            return jsonify({
                "success": False,
                "message": "Usuário não encontrado"
            }), 401

        if usuario["senha"] != senha:
            cursor.close()
            db.close()
            return jsonify({
                "success": False,
                "message": "Senha incorreta"
            }), 401

        session["usuario_id"] = usuario["id_usuario"]

        cursor.close()
        db.close()

        return jsonify({
            "success": True,
            "message": "Login autorizado"
        })

    # ---------------- SOLICITAR RECUPERAÇÃO ---------------- #
    elif acao == "solicitar_recuperacao":
        if not email:
            cursor.close()
            db.close()
            return jsonify({
                "success": False,
                "message": "Informe o e-mail cadastrado."
            }), 400

        cursor.execute("SELECT id_usuario FROM usuario WHERE email=%s", (email,))
        usuario = cursor.fetchone()

        if not usuario:
            cursor.close()
            db.close()
            return jsonify({
                "success": False,
                "message": "Nenhum usuário foi encontrado com esse e-mail."
            }), 404

        codigo = f"{random.randint(0, 999999):06d}"
        session["reset_email"] = email
        session["reset_code"] = codigo
        session["reset_verified"] = False

        cursor.close()
        db.close()

        return jsonify({
            "success": True,
            "message": "Código enviado para o e-mail informado.",
            "codigo_teste": codigo
        })

    # ---------------- VALIDAR CÓDIGO ---------------- #
    elif acao == "validar_codigo_recuperacao":
        codigo = dados.get("codigo")

        if not email or not codigo:
            cursor.close()
            db.close()
            return jsonify({
                "success": False,
                "message": "Informe o e-mail e o código recebido."
            }), 400

        email_sessao = session.get("reset_email")
        codigo_sessao = session.get("reset_code")

        if email_sessao != email or codigo_sessao != codigo:
            cursor.close()
            db.close()
            return jsonify({
                "success": False,
                "message": "Código inválido ou expirado."
            }), 401

        session["reset_verified"] = True

        cursor.close()
        db.close()

        return jsonify({
            "success": True,
            "message": "Código confirmado."
        })

    # ---------------- RECUPERAR SENHA ---------------- #
    elif acao == "recuperar_senha":
        nova_senha = dados.get("nova_senha")
        codigo = dados.get("codigo")

        if not email or not nova_senha or not codigo:
            cursor.close()
            db.close()
            return jsonify({
                "success": False,
                "message": "Informe o e-mail, o código e a nova senha."
            }), 400

        email_sessao = session.get("reset_email")
        codigo_sessao = session.get("reset_code")
        reset_verified = session.get("reset_verified")

        if email_sessao != email or codigo_sessao != codigo or not reset_verified:
            cursor.close()
            db.close()
            return jsonify({
                "success": False,
                "message": "Confirme o código antes de atualizar a senha."
            }), 401

        cursor.execute("SELECT id_usuario FROM usuario WHERE email=%s", (email,))
        usuario = cursor.fetchone()

        if not usuario:
            cursor.close()
            db.close()
            return jsonify({
                "success": False,
                "message": "Nenhum usuário foi encontrado com esse e-mail."
            }), 404

        cursor.execute(
            "UPDATE usuario SET senha=%s WHERE email=%s",
            (nova_senha, email)
        )
        db.commit()
        session.pop("reset_email", None)
        session.pop("reset_code", None)
        session.pop("reset_verified", None)

        cursor.close()
        db.close()

        return jsonify({
            "success": True,
            "message": "Senha atualizada com sucesso."
        })

    # ---------------- ALTERAR SENHA (logado) ---------------- #
    elif acao == "alterar_senha":
        uid = session.get("usuario_id")
        if not uid:
            cursor.close()
            db.close()
            return jsonify({"success": False, "message": "Faça login para alterar a senha."}), 401
        senha_atual = dados.get("senha_atual") or dados.get("senha")
        nova_senha = dados.get("nova_senha")
        if not senha_atual or not nova_senha:
            cursor.close()
            db.close()
            return jsonify({"success": False, "message": "Informe senha atual e nova senha."}), 400
        if len(str(nova_senha)) < 6:
            cursor.close()
            db.close()
            return jsonify({"success": False, "message": "A nova senha deve ter pelo menos 6 caracteres."}), 400
        cursor.execute("SELECT senha FROM usuario WHERE id_usuario=%s", (uid,))
        row = cursor.fetchone()
        if not row or row["senha"] != senha_atual:
            cursor.close()
            db.close()
            return jsonify({"success": False, "message": "Senha atual incorreta."}), 401
        cursor.execute("UPDATE usuario SET senha=%s WHERE id_usuario=%s", (nova_senha, uid))
        db.commit()
        cursor.close()
        db.close()
        return jsonify({"success": True, "message": "Senha alterada com sucesso."})

    # ---------------- CADASTRO ---------------- #
    elif acao == "cadastro":

        nome_user = dados.get("nome_user")
        cpf = dados.get("cpf")
        data_nascimento = dados.get("data_nascimento")
        peso = dados.get("peso")
        altura = dados.get("altura")
        email = dados.get("email")
        senha = dados.get("senha")
        cep = dados.get("cep")
        rua_user = dados.get("rua_user")
        bairro_user = dados.get("bairro_user")
        cidade_user = dados.get("cidade_user")
        uf_user = dados.get("uf_user")

        avaliacao = 0

        endereco_completo = f"{rua_user}, {bairro_user}, {cidade_user}, {uf_user}, Brasil"
        latitude, longitude = obter_coordenadas(endereco_completo)
        
        print("Latitude:", latitude)
        print("Longitude:", longitude)

        try:
            cursor.execute("""
                INSERT INTO usuario 
                (nome_user, cpf, data_nascimento, peso, altura, email, senha,
                 cep, rua_user, bairro_user, cidade_user, uf_user,
                 latitude, longitude, avaliacao)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            """, (
                nome_user,
                cpf,
                data_nascimento,
                peso,
                altura,
                email,
                senha,
                cep,
                rua_user,
                bairro_user,
                cidade_user,
                uf_user,
                latitude,
                longitude,
                avaliacao
            ))

            db.commit()

            return jsonify({"success": True})

        except mysql.connector.Error as erro:
            print("Erro ao cadastrar:", erro)

            if erro.errno == 1062:
                return jsonify({
                    "success": False,
                    "message": "Este CPF ou email já está cadastrado."
                }), 400

            return jsonify({
                "success": False,
                "message": "Erro ao cadastrar usuário."
            }), 400

        finally:
            cursor.close()
            db.close()

    else:
        cursor.close()
        db.close()
        return jsonify({"success": False, "message": "Ação inválida"}), 400
    # ---------------- EVENTOS ---------------- #

@app.route('/eventos', methods=['GET'])
def listar_eventos():
    _ensure_runtime_schema()
    db = conectar_banco()
    if db is None:
        return jsonify({"erro": "Erro conexão banco"}), 500

    debug_mode = str(request.args.get("debug") or "").strip().lower() in {"1", "true", "yes"}
    cursor = db.cursor(dictionary=True)
    cursor.execute(
        """
        SELECT e.*, u.nome_user AS criador_nome, q.nome_quadra
          FROM eventos e
          LEFT JOIN usuario u ON e.usuario_id = u.id_usuario
          LEFT JOIN quadra q ON e.quadra_id = q.id_quadra
         WHERE e.data_evento >= CURDATE()
         ORDER BY e.data_evento ASC, e.horario_inicio ASC
        """
    )
    eventos = cursor.fetchall()

    part_map = {}
    guest_map = {}
    diagnostico = {}

    part_schema = _resolve_event_participantes_schema(cursor)
    if part_schema and part_schema.get("user_col"):
        try:
            papel_sql = f"ep.{part_schema['papel_col']}" if part_schema.get("papel_col") else "'jogador'"
            cursor.execute(
                f"""
                SELECT ep.id_evento,
                       ep.{part_schema['user_col']} AS usuario_id,
                       {papel_sql} AS papel,
                       u.nome_user
                  FROM evento_participantes ep
                  LEFT JOIN usuario u ON u.id_usuario = ep.{part_schema['user_col']}
                """
            )
            for pr in cursor.fetchall():
                eid = pr["id_evento"]
                part_map.setdefault(eid, []).append(
                    {
                        "usuario_id": pr["usuario_id"],
                        "papel": pr["papel"] or "jogador",
                        "nome_user": pr.get("nome_user"),
                    }
                )
        except mysql.connector.Error as e:
            part_map = {}
            if debug_mode:
                diagnostico["erro_participantes"] = str(e)

    guest_schema = _resolve_guest_participantes_schema(cursor)
    if guest_schema and guest_schema.get("name_col"):
        try:
            cpf_sql = f"g.{guest_schema['cpf_col']}" if guest_schema.get("cpf_col") else "NULL"
            idade_sql = f"g.{guest_schema['idade_col']}" if guest_schema.get("idade_col") else "NULL"
            peso_sql = f"g.{guest_schema['peso_col']}" if guest_schema.get("peso_col") else "NULL"
            altura_sql = f"g.{guest_schema['altura_col']}" if guest_schema.get("altura_col") else "NULL"
            created_sql = f"g.{guest_schema['created_col']}" if guest_schema.get("created_col") else "NULL"
            id_sql = f"g.{guest_schema['id_col']}" if guest_schema.get("id_col") else "NULL"
            cursor.execute(
                f"""
                SELECT g.id_evento,
                       {id_sql} AS guest_id,
                       g.{guest_schema['name_col']} AS nome_guest,
                       {cpf_sql} AS cpf,
                       {idade_sql} AS idade,
                       {peso_sql} AS peso,
                       {altura_sql} AS altura,
                       {created_sql} AS data_inscricao
                  FROM evento_participantes_guest g
                """
            )
            for guest in cursor.fetchall():
                eid = guest["id_evento"]
                guest_map.setdefault(eid, []).append(
                    {
                        "guest_id": guest.get("guest_id"),
                        "nome_guest": guest.get("nome_guest"),
                        "cpf": guest.get("cpf"),
                        "idade": guest.get("idade"),
                        "peso": guest.get("peso"),
                        "altura": guest.get("altura"),
                        "data_inscricao": _serialize_dt(guest.get("data_inscricao")),
                    }
                )
        except mysql.connector.Error as e:
            guest_map = {}
            if debug_mode:
                diagnostico["erro_convidados"] = str(e)

    out = []
    for row in eventos:
        r = dict(row)
        r["horario_inicio"] = _serialize_dt(r.get("horario_inicio"))
        r["horario_termino"] = _serialize_dt(r.get("horario_termino"))
        de = r.get("data_evento")
        if de is not None and hasattr(de, "strftime"):
            r["data_evento"] = de.strftime("%Y-%m-%d")
        elif de is not None:
            r["data_evento"] = str(de)[:10]
        eid = r.get("id_evento")
        r["participantes_api"] = part_map.get(eid, [])
        r["convidados_api"] = guest_map.get(eid, [])
        r["finalizado"] = _evento_finalizado(r)
        out.append(r)

    if debug_mode:
        try:
            cursor.execute(
                """
                SELECT COUNT(*) AS total_eventos,
                       SUM(CASE WHEN u.id_usuario IS NULL THEN 1 ELSE 0 END) AS eventos_sem_usuario,
                       SUM(CASE WHEN e.quadra_id IS NOT NULL AND q.id_quadra IS NULL THEN 1 ELSE 0 END) AS eventos_sem_quadra
                  FROM eventos e
                  LEFT JOIN usuario u ON u.id_usuario = e.usuario_id
                  LEFT JOIN quadra q ON q.id_quadra = e.quadra_id
                """
            )
            diagnostico.update(cursor.fetchone() or {})
            cursor.execute(
                """
                SELECT usuario_id, COUNT(*) AS total
                  FROM eventos
                 GROUP BY usuario_id
                 ORDER BY usuario_id
                """
            )
            diagnostico["eventos_por_usuario"] = cursor.fetchall()
            diagnostico["eventos_retornados"] = len(out)
            diagnostico["schema_participantes"] = part_schema
            diagnostico["schema_convidados"] = guest_schema
        except mysql.connector.Error as e:
            diagnostico["erro_diagnostico"] = str(e)

    cursor.close()
    db.close()
    if debug_mode:
        return jsonify({"success": True, "eventos": out, "diagnostico": diagnostico})
    return jsonify(out)


@app.route('/me', methods=['GET'])
def usuario_logado():
    _ensure_runtime_schema()
    db = conectar_banco()
    if db is None:
        return jsonify({"success": False, "message": "Erro conexão banco"}), 500

    usuario_id = session.get("usuario_id")
    if not usuario_id:
        return jsonify({"success": False, "message": "Não autenticado"}), 401

    cursor = db.cursor(dictionary=True)
    try:
        try:
            cursor.execute(
                """
                SELECT id_usuario, nome_user, email,
                       COALESCE(partidas_ganhas, 0) AS partidas_ganhas,
                       COALESCE(gols, 0) AS gols,
                       COALESCE(reputacao_partidas, 4.5) AS reputacao_partidas,
                       avaliacao, bio, foto_perfil
                  FROM usuario WHERE id_usuario=%s
                """,
                (usuario_id,),
            )
        except mysql.connector.Error:
            try:
                cursor.execute(
                    """
                    SELECT id_usuario, nome_user, email,
                           COALESCE(partidas_ganhas, 0) AS partidas_ganhas,
                           COALESCE(gols, 0) AS gols,
                           COALESCE(reputacao_partidas, 4.5) AS reputacao_partidas,
                           avaliacao, bio
                      FROM usuario WHERE id_usuario=%s
                    """,
                    (usuario_id,),
                )
            except mysql.connector.Error:
                cursor.execute(
                    "SELECT id_usuario, nome_user, email FROM usuario WHERE id_usuario=%s",
                    (usuario_id,),
                )
        usuario = cursor.fetchone()
        if not usuario:
            return jsonify({"success": False, "message": "Usuário não encontrado"}), 404
        rep_snapshot = _get_user_reputation_snapshot(cursor, usuario_id, persist=True)
        db.commit()
        fp = usuario.get("foto_perfil")
        if fp and len(str(fp)) > 400000:
            fp = None
        return jsonify({
            "success": True,
            "id": usuario["id_usuario"],
            "nome": usuario["nome_user"],
            "email": usuario.get("email"),
            "partidas_ganhas": int(usuario.get("partidas_ganhas") or 0),
            "gols": int(usuario.get("gols") or 0),
            "reputacao_partidas": float(rep_snapshot["reputacao_partidas"]),
            "jogos_limpos": int(rep_snapshot["jogos_limpos"]),
            "reports_recebidos": int(rep_snapshot["reports_recebidos"]),
            "partidas_reputacao": int(rep_snapshot["partidas_reputacao"]),
            "avaliacao": usuario.get("avaliacao"),
            "bio": usuario.get("bio"),
            "foto_perfil": fp or None,
        })
    finally:
        cursor.close()
        db.close()

@app.route('/eventos', methods=['POST'])
def criar_evento():
    _ensure_runtime_schema()
    db = conectar_banco()
    if db is None:
        return jsonify({"success": False, "message": "Erro conexão banco"}), 500
    
    dados = request.get_json()
    if not dados:
        return jsonify({"success": False, "message": "Dados não recebidos"}), 400

    try:
        cursor = db.cursor()
        usuario_id = session.get("usuario_id")
        if not usuario_id:
            return jsonify({"success": False, "message": "Faça login para criar eventos."}), 401

        # Montamos a tupla com EXATAMENTE 23 itens. 
        # O .get("campo", "padrão") evita que o MySQL receba algo que ele não entende.
        # Tratamento básico para evitar campos vazios que quebram o banco

        tipo_recebido = dados.get("tipo", "").strip().lower()

        if tipo_recebido == "quadra alugada":
            tipo_final = "Quadra Alugada"
        else:
            tipo_final = "Quadra publica"

        data_evento = dados.get("data_evento")
        hora_inicio = dados.get("horario_inicio")
        hora_fim = dados.get("horario_termino")

        if not data_evento or not hora_inicio or not hora_fim:
            return jsonify({
                "success": False,
                "message": "Data e horários são obrigatórios"
            }), 400

        try:
            horario_inicio_final = datetime.strptime(
                f"{data_evento} {hora_inicio}", 
                "%Y-%m-%d %H:%M"
            )

            horario_termino_final = datetime.strptime(
                f"{data_evento} {hora_fim}", 
                "%Y-%m-%d %H:%M"
            )

        except ValueError:
            return jsonify({
                "success": False,
                "message": "Formato de data ou hora inválido"
            }), 400

        # Normalizações para bater com ENUMs comuns do schema (ex.: misto/feminino/masculino)
        genero_norm = (dados.get("genero") or "").strip()
        genero_norm = genero_norm.lower() if genero_norm else None

        # Tratamento de CEP e endereço (schema atual usa rua_evento/numero_evento e cep_evento varchar(8))
        cep_raw = (dados.get("cep_evento") or "").strip().replace("-", "").replace(" ", "")
        cep_evento = cep_raw if cep_raw.isdigit() and len(cep_raw) <= 8 else "00000000"

        rua_evento = (dados.get("rua_evento") or "").strip()
        _num_raw = dados.get("numero_evento")
        try:
            numero_evento = int(_num_raw) if _num_raw not in (None, "") else 0
        except (TypeError, ValueError):
            numero_evento = 0

        # Verifica conflito de horário em quadra privada (mesma quadra, mesma data, intervalo sobreposto)
        quadra_id = dados.get("quadra_id")
        if quadra_id:
            c_conf = db.cursor()
            c_conf.execute(
                """
                SELECT 1
                  FROM eventos
                 WHERE quadra_id = %s
                   AND data_evento = %s
                   AND NOT (horario_termino <= %s OR horario_inicio >= %s)
                 LIMIT 1
                """,
                (quadra_id, data_evento, horario_inicio_final, horario_termino_final)
            )
            ocupado = c_conf.fetchone()
            c_conf.close()
            if ocupado:
                return jsonify({
                    "success": False,
                    "message": "Horário já ocupado para esta quadra."
                }), 400

            # Simula notificação para o dono da quadra e aceitação
            try:
                c_owner = db.cursor()
                c_owner.execute("SELECT usuario_id FROM quadra WHERE id_quadra = %s", (quadra_id,))
                dono = c_owner.fetchone()
                c_owner.close()
                print(f"Notificando dono da quadra {quadra_id} (usuario_id={dono[0] if dono else 'desconhecido'}) para aprovar o evento...")
                print("Dono da quadra aprovou a criação do evento (simulação).")
            except Exception as _:
                print("Falha ao simular notificação do dono da quadra (ignorado).")

        # Descobre colunas reais do banco e monta INSERT só com o que existe.
        col_cursor = db.cursor()
        table_cols = _get_table_columns(col_cursor, "eventos")
        col_cursor.close()

        payload = {
            "nome_evento": dados.get("nome_evento") or "Evento Sem Nome",
            "tipo": tipo_final,
            "faixa_etaria": dados.get("faixa_etaria") or "Livre",
            "genero": genero_norm or (dados.get("genero") or None),
            "esporte_evento": dados.get("esporte_evento") or "Futebol",
            "descricao_evento": dados.get("descricao_evento") or "",
            "data_evento": data_evento,
            "horario_inicio": horario_inicio_final,
            "horario_termino": horario_termino_final,
            "max_jogadorees": dados.get("max_jogadorees") or dados.get("max_vagas") or None,
            "qtd_times": dados.get("qtd_times") or 2,
            "jogadores_time": dados.get("jogadores_time") or 5,
            "valor_aluguel": dados.get("valor_aluguel") or 0.0,
            "horas_aluguel": dados.get("horas_aluguel") or 1,
            "pix": dados.get("pix") or "",
            "beneficiario": dados.get("beneficiario") or "",
            "banco": dados.get("banco") or "",
            "rua_evento": rua_evento,
            "cidade_evento": dados.get("cidade_evento") or "",
            "bairro_evento": dados.get("bairro_evento") or "",
            "numero_evento": numero_evento,
            "cep_evento": cep_evento,
            "latitude_evento": _as_float(dados.get("latitude_evento")),
            "longitude_evento": _as_float(dados.get("longitude_evento")),
            "codigo_convite": dados.get("codigo_convite") or "",
            "usuario_id": usuario_id,
            "quadra_id": dados.get("quadra_id") or None,
        }

        insert_cols = [c for c in payload.keys() if c in table_cols]
        insert_vals = [payload[c] for c in insert_cols]

        if not insert_cols:
            return jsonify({"success": False, "message": "Tabela 'eventos' sem colunas reconhecidas para inserir."}), 500

        placeholders = ", ".join(["%s"] * len(insert_cols))
        col_list = ", ".join(insert_cols)
        sql = f"INSERT INTO eventos ({col_list}) VALUES ({placeholders})"

        cursor.execute(sql, tuple(insert_vals))
        new_id = cursor.lastrowid
        if new_id:
            try:
                _insert_event_participant(db, new_id, usuario_id, "jogador")
            except mysql.connector.Error:
                pass
        db.commit()

        return jsonify({
            "success": True,
            "message": "Evento criado!",
            "evento_id": new_id
        }), 201

    except mysql.connector.Error as e:
        # Erro comum quando o schema está diferente do esperado (ex.: coluna inexistente)
        print("ERRO NO BANCO (MySQL):", str(e))
        return jsonify({"success": False, "message": str(e)}), 400
    except Exception as e:
        print("ERRO NO BANCO:", str(e)) # Isso vai aparecer no seu terminal do VS Code
        return jsonify({"success": False, "message": str(e)}), 400
    finally:
        cursor.close()
        db.close()


    # ---------------- QUADRAS ---------------- #
@app.route('/quadra', methods=['POST'])
def criar_quadras():
    db = conectar_banco()
    if db is None:
        return jsonify({"success": False, "message": "Erro conexão banco"}), 500
    
    dados = request.get_json()
    if not dados:
        return jsonify({"success": False, "message": "Dados não recebidos"}), 400

    try:
        cursor = db.cursor()
        usuario_id = session.get("usuario_id")
        if not usuario_id:
            return jsonify({"success": False, "message": "Faça login para cadastrar quadras."}), 401

        # Tratamento básico para evitar campos vazios que quebram o banco
        valores = (
            dados.get("nome_quadra") or "Quadra Sem Nome",
            dados.get("rua_quadra") or "",
            dados.get("numero_quadra") or "",
            dados.get("cidade_quadra") or "",
            dados.get("bairro_quadra") or "",
            dados.get("cep_quadra") or "",
            dados.get("estado_quadra") or "MG",
            dados.get("superficie") or "Concreto",
            dados.get("esporte_quadra") or "Futebol",
            dados.get("capacidade") or 0,
            usuario_id,
        )

        sql = """
            INSERT INTO quadra (
                nome_quadra, rua_quadra, numero_quadra, cidade_quadra, bairro_quadra, cep_quadra, estado_quadra, superficie, esporte_quadra, capacidade, usuario_id
            )
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
        """
        print("DADOS RECEBIDOS:", dados)
        for i, v in enumerate(valores):
            print(i, v)

        cursor.execute(sql, valores)
        db.commit()
        
        return jsonify({
            "success": True,
            "message": "Quadra criada!",
            "id_quadra": cursor.lastrowid
        }), 201

    except Exception as e:
        print("ERRO NO BANCO:", str(e)) # Isso vai aparecer no seu terminal do VS Code
        return jsonify({"success": False, "message": str(e)}), 400
    finally:
        cursor.close()
        db.close()

@app.route('/api/gerar-mapa', methods=['POST'])
def gerar_mapa():
    dados = request.get_json()
    if not dados:
        return jsonify({"sucesso": False, "mensagem": "Dados inválidos"}), 400

    latitude = _as_float(dados.get("latitude_evento") or dados.get("latitude"))
    longitude = _as_float(dados.get("longitude_evento") or dados.get("longitude"))
    if latitude is not None and longitude is not None:
        url_google_maps = f"https://www.google.com/maps/search/?api=1&query={latitude},{longitude}"
        return jsonify({
            "sucesso": True,
            "url_google_maps": url_google_maps,
            "endereco_texto": f"{latitude}, {longitude}"
        }), 200

    # Pega os dados garantindo que aceita tanto 'rua' quanto 'rua_evento' (o que seu JS manda)
    rua = dados.get('rua_evento') or dados.get('rua') or ""
    numero = dados.get('numero_evento') or dados.get('numero') or ""
    bairro = dados.get('bairro_evento') or dados.get('bairro') or ""
    cidade = dados.get('cidade_evento') or dados.get('cidade') or ""
    estado = dados.get('estado_evento') or dados.get('estado') or ""

    # 1. Monta a lista de partes APENAS com o que não estiver vazio
    # IMPORTANTE: A ordem importa para o Google! Rua e Número devem vir primeiro.
    partes = []
    if rua: partes.append(rua)
    if numero: partes.append(str(numero))
    if bairro: partes.append(bairro)
    if cidade: partes.append(cidade)
    if estado: partes.append(estado)
    partes.append("Brasil")

    # 2. Junta tudo com vírgulas
    endereco_completo = ", ".join(partes)

    if len(partes) <= 1: # Se só tiver "Brasil", o endereço está vazio
         return jsonify({"sucesso": False, "mensagem": "Endereço insuficiente para o mapa"}), 400

    # 3. Codifica para formato de URL (resolve problemas de espaços e acentos)
    endereco_codificado = urllib.parse.quote(endereco_completo)
    
    # 4. URL OFICIAL DE BUSCA DO GOOGLE MAPS
    # Este formato força o Google a procurar o endereço exato que montamos
    url_google_maps = f"https://www.google.com/maps/search/?api=1&query={endereco_codificado}"

    return jsonify({
        "sucesso": True,
        "url_google_maps": url_google_maps,
        "endereco_texto": endereco_completo # Útil para você conferir no console do navegador
    }), 200


@app.route('/api/user-sports', methods=['GET'])
def get_user_sports():
    db = conectar_banco()
    if db is None:
        return jsonify({"success": False, "message": "Erro conexão banco"}), 500

    usuario_id = session.get("usuario_id")
    if not usuario_id:
        return jsonify({"success": False, "message": "Usuário não logado"}), 401

    cursor = db.cursor(dictionary=True)
    cursor.execute("SELECT id, esporte, posicao, observacao FROM usuario_esportes WHERE usuario_id=%s", (usuario_id,))
    sports = cursor.fetchall()
    cursor.close()
    db.close()
    return jsonify({"success": True, "sports": sports})

@app.route('/api/user-sports', methods=['POST'])
def add_user_sport():
    db = conectar_banco()
    if db is None:
        return jsonify({"success": False, "message": "Erro conexão banco"}), 500

    usuario_id = session.get("usuario_id")
    if not usuario_id:
        return jsonify({"success": False, "message": "Usuário não logado"}), 401

    dados = request.get_json()
    esporte = dados.get("esporte")
    posicao = dados.get("posicao")
    observacao = dados.get("observacao", "")

    if not esporte:
        return jsonify({"success": False, "message": "Esporte é obrigatório"}), 400

    cursor = db.cursor()
    cursor.execute("INSERT INTO usuario_esportes (usuario_id, esporte, posicao, observacao) VALUES (%s, %s, %s, %s)", (usuario_id, esporte, posicao, observacao))
    db.commit()
    cursor.close()
    db.close()
    return jsonify({"success": True, "message": "Esporte adicionado"})

@app.route('/api/user-sports/<int:sport_id>', methods=['DELETE'])
def delete_user_sport(sport_id):
    db = conectar_banco()
    if db is None:
        return jsonify({"success": False, "message": "Erro conexão banco"}), 500

    usuario_id = session.get("usuario_id")
    if not usuario_id:
        return jsonify({"success": False, "message": "Usuário não logado"}), 401

    cursor = db.cursor()
    cursor.execute("DELETE FROM usuario_esportes WHERE id=%s AND usuario_id=%s", (sport_id, usuario_id))
    db.commit()
    deleted = cursor.rowcount > 0
    cursor.close()
    db.close()
    if deleted:
        return jsonify({"success": True, "message": "Esporte removido"})
    else:
        return jsonify({"success": False, "message": "Esporte não encontrado"}), 404

def _parse_event_times(dados):
    tipo_recebido = (dados.get("tipo") or "").strip().lower()
    tipo_final = "Quadra Alugada" if tipo_recebido == "quadra alugada" else "Quadra publica"
    data_evento = dados.get("data_evento")
    hora_inicio = dados.get("horario_inicio")
    hora_fim = dados.get("horario_termino")
    if not data_evento or not hora_inicio or not hora_fim:
        return None, "Data e horários são obrigatórios"
    try:
        hi = datetime.strptime(f"{data_evento} {hora_inicio}", "%Y-%m-%d %H:%M")
        hf = datetime.strptime(f"{data_evento} {hora_fim}", "%Y-%m-%d %H:%M")
    except ValueError:
        return None, "Formato de data ou hora inválido"
    genero_norm = (dados.get("genero") or "").strip().lower() or None
    cep_raw = (dados.get("cep_evento") or "").strip().replace("-", "").replace(" ", "")
    cep_evento = cep_raw if cep_raw.isdigit() and len(cep_raw) <= 8 else "00000000"
    rua_evento = (dados.get("rua_evento") or "").strip()
    try:
        numero_evento = int(dados.get("numero_evento")) if dados.get("numero_evento") not in (None, "") else 0
    except (TypeError, ValueError):
        numero_evento = 0
    payload = {
        "nome_evento": dados.get("nome_evento") or "Evento Sem Nome",
        "tipo": tipo_final,
        "faixa_etaria": dados.get("faixa_etaria") or "Livre",
        "genero": genero_norm,
        "esporte_evento": dados.get("esporte_evento") or "Futebol",
        "descricao_evento": dados.get("descricao_evento") or "",
        "data_evento": data_evento,
        "horario_inicio": hi,
        "horario_termino": hf,
        "max_jogadorees": dados.get("max_jogadorees") or dados.get("max_vagas") or None,
        "qtd_times": dados.get("qtd_times") or 2,
        "jogadores_time": dados.get("jogadores_time") or 5,
        "valor_aluguel": dados.get("valor_aluguel") or 0.0,
        "horas_aluguel": dados.get("horas_aluguel") or 1,
        "pix": dados.get("pix") or "",
        "beneficiario": dados.get("beneficiario") or "",
        "banco": dados.get("banco") or "",
        "rua_evento": rua_evento,
        "cidade_evento": dados.get("cidade_evento") or "",
        "bairro_evento": dados.get("bairro_evento") or "",
        "numero_evento": numero_evento,
        "cep_evento": cep_evento,
        "latitude_evento": _as_float(dados.get("latitude_evento")),
        "longitude_evento": _as_float(dados.get("longitude_evento")),
        "codigo_convite": dados.get("codigo_convite") or "",
        "quadra_id": dados.get("quadra_id") or None,
    }
    return payload, None


@app.route("/quadras", methods=["GET"])
def listar_quadras():
    db = conectar_banco()
    if db is None:
        return jsonify({"success": False, "message": "Erro conexão banco"}), 500
    cursor = db.cursor(dictionary=True)
    cursor.execute(
        """
        SELECT q.*, u.nome_user AS dono_nome
          FROM quadra q
          LEFT JOIN usuario u ON q.usuario_id = u.id_usuario
         ORDER BY q.id_quadra DESC
        """
    )
    rows = cursor.fetchall()
    cursor.close()
    db.close()
    return jsonify({"success": True, "quadras": rows})


@app.route("/eventos/<int:event_id>", methods=["PUT"])
def atualizar_evento(event_id):
    uid = _current_user_id(require=True)
    if not uid:
        return jsonify({"success": False, "message": "Faça login."}), 401
    dados = request.get_json()
    if not dados:
        return jsonify({"success": False, "message": "Dados não recebidos"}), 400
    _ensure_runtime_schema()
    payload, err = _parse_event_times(dados)
    if err:
        return jsonify({"success": False, "message": err}), 400
    payload["usuario_id"] = uid

    db = conectar_banco()
    if db is None:
        return jsonify({"success": False, "message": "Erro conexão banco"}), 500
    try:
        cursor = db.cursor()
        cursor.execute(
            "SELECT usuario_id FROM eventos WHERE id_evento=%s",
            (event_id,),
        )
        row = cursor.fetchone()
        if not row:
            cursor.close()
            db.close()
            return jsonify({"success": False, "message": "Evento não encontrado"}), 404
        if row[0] != uid:
            cursor.close()
            db.close()
            return jsonify({"success": False, "message": "Apenas o criador pode editar."}), 403

        col_cursor = db.cursor()
        table_cols = _get_table_columns(col_cursor, "eventos")
        col_cursor.close()

        upd = {k: v for k, v in payload.items() if k in table_cols and k != "usuario_id"}
        if not upd:
            cursor.close()
            db.close()
            return jsonify({"success": False, "message": "Nada para atualizar."}), 400
        sets = ", ".join([f"{k}=%s" for k in upd.keys()])
        vals = list(upd.values()) + [event_id, uid]
        sql = f"UPDATE eventos SET {sets} WHERE id_evento=%s AND usuario_id=%s"
        cursor.execute(sql, tuple(vals))
        db.commit()
        cursor.close()
        db.close()
        return jsonify({"success": True, "message": "Evento atualizado."})
    except Exception as e:
        return jsonify({"success": False, "message": str(e)}), 400


@app.route("/eventos/<int:event_id>", methods=["DELETE"])
def excluir_evento(event_id):
    uid = _current_user_id(require=True)
    if not uid:
        return jsonify({"success": False, "message": "Faça login."}), 401
    db = conectar_banco()
    if db is None:
        return jsonify({"success": False, "message": "Erro conexão banco"}), 500
    cursor = db.cursor()
    cursor.execute(
        "DELETE FROM eventos WHERE id_evento=%s AND usuario_id=%s",
        (event_id, uid),
    )
    db.commit()
    ok = cursor.rowcount > 0
    cursor.close()
    db.close()
    if ok:
        return jsonify({"success": True, "message": "Evento excluído."})
    return jsonify({"success": False, "message": "Evento não encontrado ou sem permissão."}), 404


@app.route("/eventos/<int:event_id>/participar", methods=["POST"])
def participar_evento(event_id):
    uid = _current_user_id(require=True)
    if not uid:
        return jsonify({"success": False, "message": "Faça login."}), 401
    db = conectar_banco()
    if db is None:
        return jsonify({"success": False, "message": "Erro conexão banco"}), 500
    try:
        cursor = db.cursor(dictionary=True)
        cursor.execute(
            "SELECT max_jogadorees FROM eventos WHERE id_evento=%s",
            (event_id,),
        )
        ev = cursor.fetchone()
        if not ev:
            cursor.close()
            db.close()
            return jsonify({"success": False, "message": "Evento não encontrado."}), 404
        if _event_participant_exists(cursor, event_id, uid):
            cursor.close()
            db.close()
            return jsonify({"success": False, "message": "Você já está neste evento."}), 400
        max_j = ev.get("max_jogadorees") or 999
        cnt = _count_event_confirmados(cursor, event_id)
        if cnt >= max_j:
            cursor.close()
            db.close()
            return jsonify({"success": False, "message": "Evento lotado."}), 400
        _insert_event_participant(db, event_id, uid, "jogador")
        db.commit()
        cursor.close()
        db.close()
        return jsonify({"success": True, "message": "Você entrou no evento."})
    except mysql.connector.Error as e:
        if e.errno == 1062:
            return jsonify({"success": False, "message": "Você já está neste evento."}), 400
        return jsonify({"success": False, "message": str(e)}), 400


@app.route("/eventos/<int:event_id>/participar", methods=["DELETE"])
def sair_evento(event_id):
    uid = _current_user_id(require=True)
    if not uid:
        return jsonify({"success": False, "message": "Faça login."}), 401
    db = conectar_banco()
    if db is None:
        return jsonify({"success": False, "message": "Erro conexão banco"}), 500
    try:
        cursor = db.cursor()
        schema = _resolve_event_participantes_schema(cursor)
        if not schema or not schema.get("user_col"):
            cursor.close()
            db.close()
            return jsonify({"success": False, "message": "Tabela de participantes indisponível."}), 500
        cursor.execute(
            f"DELETE FROM evento_participantes WHERE id_evento=%s AND {schema['user_col']}=%s",
            (event_id, uid),
        )
        db.commit()
        ok = cursor.rowcount > 0
        cursor.close()
        db.close()
        if ok:
            return jsonify({"success": True, "message": "Você saiu do evento."})
        return jsonify({"success": False, "message": "Participação não encontrada."}), 404
    except mysql.connector.Error as e:
        return jsonify({"success": False, "message": str(e)}), 400


@app.route("/eventos/<int:event_id>/convidar", methods=["POST"])
def convidar_usuario_evento(event_id):
    """Apenas o criador do evento adiciona outro usuário logado como participante."""
    uid = _current_user_id(require=True)
    if not uid:
        return jsonify({"success": False, "message": "Faça login."}), 401
    dados = request.get_json() or {}
    try:
        alvo = int(dados.get("usuario_id"))
    except (TypeError, ValueError):
        return jsonify({"success": False, "message": "usuario_id inválido."}), 400
    if alvo == uid:
        return jsonify({"success": False, "message": "Use outro jogador."}), 400
    db = conectar_banco()
    if db is None:
        return jsonify({"success": False, "message": "Erro conexão banco"}), 500
    try:
        cursor = db.cursor()
        cursor.execute(
            "SELECT usuario_id, max_jogadorees FROM eventos WHERE id_evento=%s",
            (event_id,),
        )
        row = cursor.fetchone()
        if not row:
            cursor.close()
            db.close()
            return jsonify({"success": False, "message": "Evento não encontrado."}), 404
        if row[0] != uid:
            cursor.close()
            db.close()
            return jsonify({"success": False, "message": "Apenas o criador pode convidar."}), 403
        if _event_participant_exists(cursor, event_id, alvo):
            cursor.close()
            db.close()
            return jsonify({"success": False, "message": "Este jogador já está no evento."}), 400
        max_j = row[1] or 999
        cnt = _count_event_confirmados(cursor, event_id)
        if cnt >= max_j:
            cursor.close()
            db.close()
            return jsonify({"success": False, "message": "Evento lotado."}), 400
        _insert_event_participant(db, event_id, alvo, "jogador")
        db.commit()
        cursor.close()
        db.close()
        return jsonify({"success": True, "message": "Jogador adicionado ao evento."})
    except mysql.connector.Error as e:
        if e.errno == 1062:
            return jsonify({"success": False, "message": "Este jogador já está no evento."}), 400
        return jsonify({"success": False, "message": str(e)}), 400


@app.route("/api/presenca-guest", methods=["POST"])
def api_presenca_guest():
    _ensure_runtime_schema()
    dados = request.get_json() or {}
    event_id = _as_int(dados.get("id_evento"))
    nome = str(dados.get("nome") or dados.get("nome_guest") or "").strip()
    cpf_txt = _digits_only(dados.get("cpf"))
    idade = _as_int(dados.get("idade"))
    peso = _as_float(dados.get("peso"))
    altura = _as_float(dados.get("altura"))

    if not event_id:
        return jsonify({"success": False, "message": "id_evento inválido."}), 400
    if len(nome) < 3:
        return jsonify({"success": False, "message": "Informe o nome completo do convidado."}), 400
    if len(cpf_txt) != 11:
        return jsonify({"success": False, "message": "CPF inválido. Use 11 dígitos."}), 400
    if idade is None or idade < 5 or idade > 120:
        return jsonify({"success": False, "message": "Idade inválida."}), 400
    if peso is None or peso <= 0 or peso > 400:
        return jsonify({"success": False, "message": "Peso inválido."}), 400
    if altura is None or altura < 0.5 or altura > 2.8:
        return jsonify({"success": False, "message": "Altura inválida."}), 400

    db = conectar_banco()
    if db is None:
        return jsonify({"success": False, "message": "Erro conexão banco"}), 500

    cursor = db.cursor(dictionary=True)
    try:
        cursor.execute(
            "SELECT id_evento, data_evento, horario_termino, max_jogadorees FROM eventos WHERE id_evento=%s",
            (event_id,),
        )
        evento = cursor.fetchone()
        if not evento:
            cursor.close()
            db.close()
            return jsonify({"success": False, "message": "Evento não encontrado."}), 404
        if _evento_finalizado(evento):
            cursor.close()
            db.close()
            return jsonify({"success": False, "message": "Não é possível registrar presença em evento encerrado."}), 400

        guest_schema = _resolve_guest_participantes_schema(cursor)
        if not guest_schema or not guest_schema.get("name_col"):
            cursor.close()
            db.close()
            return jsonify({"success": False, "message": "Tabela de convidados indisponível."}), 500

        missing_cols = [
            label
            for label, key in (
                ("cpf", "cpf_col"),
                ("idade", "idade_col"),
                ("peso", "peso_col"),
                ("altura", "altura_col"),
            )
            if not guest_schema.get(key)
        ]
        if missing_cols:
            cursor.close()
            db.close()
            return jsonify(
                {
                    "success": False,
                    "message": "Schema de convidados incompleto. Execute a migration antes de registrar presença.",
                    "missing_columns": missing_cols,
                }
            ), 500

        cursor.execute(
            f"SELECT 1 FROM evento_participantes_guest WHERE id_evento=%s AND {guest_schema['cpf_col']}=%s LIMIT 1",
            (event_id, int(cpf_txt)),
        )
        if cursor.fetchone():
            _mark_guest_presence_event(event_id)
            cursor.close()
            db.close()
            return jsonify(
                {
                    "success": True,
                    "already_exists": True,
                    "message": "Presença já registrada para este CPF neste evento.",
                    "convidado": {
                        "id_evento": event_id,
                        "nome_guest": nome,
                        "cpf": int(cpf_txt),
                        "idade": idade,
                        "peso": peso,
                        "altura": altura,
                    },
                }
            )

        max_j = evento.get("max_jogadorees") or 999
        if _count_event_confirmados(cursor, event_id) >= max_j:
            cursor.close()
            db.close()
            return jsonify({"success": False, "message": "Evento lotado."}), 400

        cols = [
            "id_evento",
            guest_schema["name_col"],
            guest_schema["cpf_col"],
            guest_schema["idade_col"],
            guest_schema["peso_col"],
            guest_schema["altura_col"],
        ]
        vals = [event_id, nome, int(cpf_txt), idade, peso, altura]
        if "nome" in guest_schema.get("cols", []) and guest_schema["name_col"] != "nome":
            cols.append("nome")
            vals.append(nome)
        writer = db.cursor()
        writer.execute(
            f"INSERT INTO evento_participantes_guest ({', '.join(cols)}) VALUES ({', '.join(['%s'] * len(cols))})",
            tuple(vals),
        )
        guest_id = writer.lastrowid
        writer.close()
        db.commit()
        _mark_guest_presence_event(event_id)
        cursor.close()
        db.close()
        return jsonify(
            {
                "success": True,
                "message": "Presença confirmada.",
                "convidado": {
                    "guest_id": guest_id,
                    "id_evento": event_id,
                    "nome_guest": nome,
                    "cpf": int(cpf_txt),
                    "idade": idade,
                    "peso": peso,
                    "altura": altura,
                },
            }
        ), 201
    except mysql.connector.Error as e:
        cursor.close()
        db.close()
        return jsonify({"success": False, "message": str(e)}), 400


@app.route("/quadra/<int:quadra_id>", methods=["PUT"])
def atualizar_quadra(quadra_id):
    uid = _current_user_id(require=True)
    if not uid:
        return jsonify({"success": False, "message": "Faça login."}), 401
    dados = request.get_json() or {}
    db = conectar_banco()
    if db is None:
        return jsonify({"success": False, "message": "Erro conexão banco"}), 500
    try:
        cursor = db.cursor()
        cursor.execute(
            "SELECT usuario_id FROM quadra WHERE id_quadra=%s",
            (quadra_id,),
        )
        row = cursor.fetchone()
        if not row or row[0] != uid:
            cursor.close()
            db.close()
            return jsonify({"success": False, "message": "Sem permissão."}), 403
        campos = {
            "nome_quadra": dados.get("nome_quadra"),
            "rua_quadra": dados.get("rua_quadra"),
            "numero_quadra": dados.get("numero_quadra"),
            "cidade_quadra": dados.get("cidade_quadra"),
            "bairro_quadra": dados.get("bairro_quadra"),
            "cep_quadra": dados.get("cep_quadra"),
            "estado_quadra": dados.get("estado_quadra"),
            "superficie": dados.get("superficie"),
            "esporte_quadra": dados.get("esporte_quadra"),
            "capacidade": dados.get("capacidade"),
        }
        sets = []
        vals = []
        for k, v in campos.items():
            if k in dados:
                sets.append(f"{k}=%s")
                vals.append(v)
        if not sets:
            cursor.close()
            db.close()
            return jsonify({"success": False, "message": "Nenhum campo para atualizar."}), 400
        sql = f"UPDATE quadra SET {', '.join(sets)} WHERE id_quadra=%s AND usuario_id=%s"
        cursor.execute(sql, tuple(vals + [quadra_id, uid]))
        db.commit()
        cursor.close()
        db.close()
        return jsonify({"success": True, "message": "Quadra atualizada."})
    except Exception as e:
        return jsonify({"success": False, "message": str(e)}), 400


@app.route("/quadra/<int:quadra_id>", methods=["DELETE"])
def excluir_quadra(quadra_id):
    uid = _current_user_id(require=True)
    if not uid:
        return jsonify({"success": False, "message": "Faça login."}), 401
    db = conectar_banco()
    if db is None:
        return jsonify({"success": False, "message": "Erro conexão banco"}), 500
    cursor = db.cursor()
    cursor.execute(
        "DELETE FROM quadra WHERE id_quadra=%s AND usuario_id=%s",
        (quadra_id, uid),
    )
    db.commit()
    ok = cursor.rowcount > 0
    cursor.close()
    db.close()
    if ok:
        return jsonify({"success": True, "message": "Quadra excluída."})
    return jsonify({"success": False, "message": "Quadra não encontrada ou sem permissão."}), 404


@app.route("/api/dashboard-resumo", methods=["GET"])
def api_dashboard_resumo():
    _ensure_runtime_schema()
    uid = _current_user_id(require=True)
    if not uid:
        return jsonify({"success": False, "message": "Faça login."}), 401
    db = conectar_banco()
    if db is None:
        return jsonify({"success": False, "message": "Erro conexão banco"}), 500
    cursor = db.cursor(dictionary=True)
    try:
        rep_snapshot = _get_user_reputation_snapshot(cursor, uid, persist=True)
        db.commit()
        try:
            cursor.execute(
                "SELECT COALESCE(partidas_ganhas,0) AS pg, COALESCE(gols,0) AS gols FROM usuario WHERE id_usuario=%s",
                (uid,),
            )
        except mysql.connector.Error:
            cursor.execute("SELECT 0 AS pg, 0 AS gols FROM usuario WHERE id_usuario=%s", (uid,))
        urow = cursor.fetchone() or {"pg": 0, "gols": 0}
        cursor.execute(
            "SELECT COUNT(*) AS c FROM eventos WHERE usuario_id=%s",
            (uid,),
        )
        ev_criados = cursor.fetchone()["c"]
        cursor.execute(
            """SELECT q.nome_quadra, COUNT(e.id_evento) AS n
                 FROM quadra q
                 LEFT JOIN eventos e ON e.quadra_id = q.id_quadra
                WHERE q.usuario_id=%s
                GROUP BY q.id_quadra, q.nome_quadra
                ORDER BY n DESC
                LIMIT 5""",
            (uid,),
        )
        qrows = cursor.fetchall()
        quadras_freq = [{"nome": r["nome_quadra"], "total_eventos": int(r["n"])} for r in (qrows or [])]
        cursor.close()
        db.close()
        return jsonify({
            "success": True,
            "partidas_ganhas": int(urow.get("pg") or 0),
            "gols": int(urow.get("gols") or 0),
            "reputacao_partidas": float(rep_snapshot["reputacao_partidas"]),
            "jogos_limpos": int(rep_snapshot["jogos_limpos"]),
            "reports_recebidos": int(rep_snapshot["reports_recebidos"]),
            "partidas_reputacao": int(rep_snapshot["partidas_reputacao"]),
            "eventos_criados": int(ev_criados),
            "quadras_mais_frequentadas": quadras_freq,
        })
    except Exception as e:
        cursor.close()
        db.close()
        return jsonify({"success": False, "message": str(e)}), 500


@app.route("/api/usuarios", methods=["GET"])
def api_lista_usuarios():
    uid = _current_user_id(require=True)
    if not uid:
        return jsonify({"success": False, "message": "Faça login."}), 401
    q = (request.args.get("q") or "").strip()
    db = conectar_banco()
    if db is None:
        return jsonify({"success": False, "message": "Erro conexão banco"}), 500
    cursor = db.cursor(dictionary=True)
    if q:
        cursor.execute(
            "SELECT id_usuario, nome_user, email FROM usuario WHERE id_usuario <> %s AND (nome_user LIKE %s OR email LIKE %s) LIMIT 40",
            (uid, f"%{q}%", f"%{q}%"),
        )
    else:
        cursor.execute(
            "SELECT id_usuario, nome_user, email FROM usuario WHERE id_usuario <> %s ORDER BY nome_user LIMIT 40",
            (uid,),
        )
    rows = cursor.fetchall()
    cursor.close()
    db.close()
    return jsonify({"success": True, "usuarios": rows})


@app.route("/api/perfil/<int:user_id>", methods=["GET"])
def api_perfil_publico(user_id):
    _ensure_runtime_schema()
    db = conectar_banco()
    if db is None:
        return jsonify({"success": False, "message": "Erro conexão banco"}), 500
    cursor = db.cursor(dictionary=True)
    try:
        cursor.execute(
            """SELECT id_usuario, nome_user, email, cidade_user, bairro_user,
                      COALESCE(partidas_ganhas,0) AS partidas_ganhas, COALESCE(gols,0) AS gols,
                      COALESCE(reputacao_partidas,4.5) AS reputacao_partidas, bio, avaliacao
                 FROM usuario WHERE id_usuario=%s""",
            (user_id,),
        )
    except mysql.connector.Error:
        cursor.execute(
            "SELECT id_usuario, nome_user, email, cidade_user, bairro_user, bio, avaliacao FROM usuario WHERE id_usuario=%s",
            (user_id,),
        )
    row = cursor.fetchone()
    if not row:
        cursor.close()
        db.close()
        return jsonify({"success": False, "message": "Usuário não encontrado."}), 404
    rep_snapshot = _get_user_reputation_snapshot(cursor, user_id, persist=True)
    db.commit()
    row["reputacao_partidas"] = float(rep_snapshot["reputacao_partidas"])
    row["jogos_limpos"] = int(rep_snapshot["jogos_limpos"])
    row["reports_recebidos"] = int(rep_snapshot["reports_recebidos"])
    row["partidas_reputacao"] = int(rep_snapshot["partidas_reputacao"])
    row["historico_reputacao"] = rep_snapshot["historico_reputacao"]
    cursor.close()
    db.close()
    return jsonify({"success": True, "perfil": row})


@app.route("/api/jogadores/<int:user_id>/report", methods=["POST"])
def api_reportar_jogador(user_id):
    _ensure_runtime_schema()
    reporter_id = _current_user_id(require=True)
    if not reporter_id:
        return jsonify({"success": False, "message": "Faça login."}), 401
    if int(user_id) == int(reporter_id):
        return jsonify({"success": False, "message": "Você não pode reportar o próprio perfil."}), 400

    dados = request.get_json() or {}
    event_id = _as_int(dados.get("event_id"))
    if not event_id:
        return jsonify({"success": False, "message": "Informe o evento da ocorrência."}), 400

    db = conectar_banco()
    if db is None:
        return jsonify({"success": False, "message": "Erro conexão banco"}), 500

    cursor = db.cursor(dictionary=True)
    try:
        cursor.execute(
            "SELECT id_evento, usuario_id FROM eventos WHERE id_evento=%s",
            (event_id,),
        )
        evento = cursor.fetchone()
        if not evento:
            return jsonify({"success": False, "message": "Evento não encontrado."}), 404

        reporter_in_event = _event_participant_exists(cursor, event_id, reporter_id) or int(evento["usuario_id"]) == int(reporter_id)
        target_in_event = _event_participant_exists(cursor, event_id, user_id) or int(evento["usuario_id"]) == int(user_id)
        if not reporter_in_event or not target_in_event:
            return jsonify({"success": False, "message": "O report precisa estar vinculado a um jogador do evento."}), 403

        cursor.execute(
            """
            INSERT INTO jogador_reports (reporter_id, reported_user_id, id_evento)
            VALUES (%s, %s, %s)
            """,
            (reporter_id, user_id, event_id),
        )
        rep_snapshot = _get_user_reputation_snapshot(cursor, user_id, persist=True)
        db.commit()
        return jsonify({
            "success": True,
            "message": "Report registrado e reputação atualizada.",
            "reputacao_partidas": float(rep_snapshot["reputacao_partidas"]),
            "perfil": rep_snapshot,
        })
    except mysql.connector.Error as e:
        db.rollback()
        if getattr(e, "errno", None) == 1062:
            return jsonify({"success": False, "message": "Você já reportou este jogador neste evento."}), 409
        return jsonify({"success": False, "message": str(e)}), 400
    finally:
        cursor.close()
        db.close()


@app.route("/api/amizades", methods=["POST"])
def api_amizade_solicitar():
    uid = _current_user_id(require=True)
    if not uid:
        return jsonify({"success": False, "message": "Faça login."}), 401
    dados = request.get_json() or {}
    dest = dados.get("destinatario_id")
    try:
        dest = int(dest)
    except (TypeError, ValueError):
        return jsonify({"success": False, "message": "destinatario_id inválido."}), 400
    if dest == uid:
        return jsonify({"success": False, "message": "Você não pode adicionar a si mesmo."}), 400
    db = conectar_banco()
    if db is None:
        return jsonify({"success": False, "message": "Erro conexão banco"}), 500
    try:
        cursor = db.cursor()
        cursor.execute(
            """INSERT INTO amizade (solicitante_id, destinatario_id, status) VALUES (%s, %s, 'pendente')""",
            (uid, dest),
        )
        db.commit()
        aid = cursor.lastrowid
        cursor.close()
        db.close()
        return jsonify({"success": True, "message": "Pedido enviado.", "id_amizade": aid})
    except mysql.connector.Error as e:
        if e.errno == 1062:
            return jsonify({"success": False, "message": "Já existe pedido ou amizade com este jogador."}), 400
        return jsonify({"success": False, "message": str(e)}), 400


@app.route("/api/amizades/pendentes", methods=["GET"])
def api_amizade_pendentes():
    uid = _current_user_id(require=True)
    if not uid:
        return jsonify({"success": False, "message": "Faça login."}), 401
    db = conectar_banco()
    if db is None:
        return jsonify({"success": False, "message": "Erro conexão banco"}), 500
    cursor = db.cursor(dictionary=True)
    cursor.execute(
        """
        SELECT a.id_amizade, a.solicitante_id, a.destinatario_id, a.status, u.nome_user AS solicitante_nome
          FROM amizade a
          JOIN usuario u ON a.solicitante_id = u.id_usuario
         WHERE a.destinatario_id = %s AND a.status = 'pendente'
         ORDER BY a.criado_em DESC
        """,
        (uid,),
    )
    inc = cursor.fetchall()
    cursor.execute(
        """
        SELECT a.id_amizade, a.solicitante_id, a.destinatario_id, a.status, u.nome_user AS destinatario_nome
          FROM amizade a
          JOIN usuario u ON a.destinatario_id = u.id_usuario
         WHERE a.solicitante_id = %s AND a.status = 'pendente'
         ORDER BY a.criado_em DESC
        """,
        (uid,),
    )
    outg = cursor.fetchall()
    cursor.close()
    db.close()
    return jsonify({"success": True, "recebidas": inc, "enviadas": outg})


@app.route("/api/amizades/<int:amizade_id>/aceitar", methods=["POST"])
def api_amizade_aceitar(amizade_id):
    uid = _current_user_id(require=True)
    if not uid:
        return jsonify({"success": False, "message": "Faça login."}), 401
    db = conectar_banco()
    if db is None:
        return jsonify({"success": False, "message": "Erro conexão banco"}), 500
    cursor = db.cursor()
    cursor.execute(
        "UPDATE amizade SET status='aceito' WHERE id_amizade=%s AND destinatario_id=%s AND status='pendente'",
        (amizade_id, uid),
    )
    db.commit()
    ok = cursor.rowcount > 0
    cursor.close()
    db.close()
    if ok:
        return jsonify({"success": True, "message": "Amizade aceita."})
    return jsonify({"success": False, "message": "Pedido não encontrado."}), 404


@app.route("/api/amizades/<int:amizade_id>/recusar", methods=["POST"])
def api_amizade_recusar(amizade_id):
    uid = _current_user_id(require=True)
    if not uid:
        return jsonify({"success": False, "message": "Faça login."}), 401
    db = conectar_banco()
    if db is None:
        return jsonify({"success": False, "message": "Erro conexão banco"}), 500
    cursor = db.cursor()
    cursor.execute(
        "UPDATE amizade SET status='recusado' WHERE id_amizade=%s AND destinatario_id=%s AND status='pendente'",
        (amizade_id, uid),
    )
    db.commit()
    ok = cursor.rowcount > 0
    cursor.close()
    db.close()
    if ok:
        return jsonify({"success": True, "message": "Pedido recusado."})
    return jsonify({"success": False, "message": "Pedido não encontrado."}), 404


@app.route("/api/amizades/lista", methods=["GET"])
def api_amizade_lista():
    uid = _current_user_id(require=True)
    if not uid:
        return jsonify({"success": False, "message": "Faça login."}), 401
    db = conectar_banco()
    if db is None:
        return jsonify({"success": False, "message": "Erro conexão banco"}), 500
    cursor = db.cursor(dictionary=True)
    cursor.execute(
        """
        SELECT a.id_amizade,
               CASE WHEN a.solicitante_id = %s THEN a.destinatario_id ELSE a.solicitante_id END AS amigo_id,
               u.nome_user AS nome
          FROM amizade a
          JOIN usuario u ON u.id_usuario = CASE WHEN a.solicitante_id = %s THEN a.destinatario_id ELSE a.solicitante_id END
         WHERE a.status = 'aceito' AND (a.solicitante_id = %s OR a.destinatario_id = %s)
         ORDER BY u.nome_user
        """,
        (uid, uid, uid, uid),
    )
    rows = cursor.fetchall()
    cursor.close()
    db.close()
    return jsonify({"success": True, "amigos": rows})


@app.route("/api/me", methods=["PUT"])
def api_atualizar_me():
    uid = _current_user_id(require=True)
    if not uid:
        return jsonify({"success": False, "message": "Faça login."}), 401
    dados = request.get_json() or {}
    nome = (dados.get("nome_user") or dados.get("nome") or "").strip()
    bio = dados.get("bio")
    if bio is not None:
        bio = str(bio).strip()[:2000]
    foto = dados.get("foto_perfil")
    if foto is not None and len(str(foto)) > 400000:
        return jsonify({"success": False, "message": "Foto muito grande (máx. ~400KB em base64)."}), 400
    db = conectar_banco()
    if db is None:
        return jsonify({"success": False, "message": "Erro conexão banco"}), 500
    cursor = db.cursor(dictionary=True)
    try:
        cols = _get_table_columns(cursor, "usuario")
        sets = []
        vals = []
        if nome:
            sets.append("nome_user=%s")
            vals.append(nome)
        if bio is not None and "bio" in cols:
            sets.append("bio=%s")
            vals.append(bio)
        if foto is not None and "foto_perfil" in cols:
            sets.append("foto_perfil=%s")
            vals.append(foto if foto else None)
        if not sets:
            cursor.close()
            db.close()
            return jsonify({"success": False, "message": "Nada para atualizar."}), 400
        vals.append(uid)
        cursor.execute(f"UPDATE usuario SET {', '.join(sets)} WHERE id_usuario=%s", tuple(vals))
        db.commit()
        cursor.close()
        db.close()
        return jsonify({"success": True, "message": "Perfil salvo no banco de dados."})
    except mysql.connector.Error as e:
        cursor.close()
        db.close()
        return jsonify({"success": False, "message": str(e)}), 400


@app.route("/api/jogadores/recentes-finalizados", methods=["GET"])
def api_jogadores_recentes_finalizados():
    uid = _current_user_id(require=True)
    if not uid:
        return jsonify({"success": False, "message": "Faça login."}), 401
    db = conectar_banco()
    if db is None:
        return jsonify({"success": False, "message": "Erro conexão banco"}), 500
    cursor = db.cursor(dictionary=True)
    schema = _resolve_event_participantes_schema(cursor)
    if not schema or not schema.get("user_col"):
        cursor.close()
        db.close()
        return jsonify({"success": True, "jogadores": []})
    try:
        cursor.execute(
            f"""
            SELECT DISTINCT u.id_usuario, u.nome_user, MAX(e.horario_termino) AS ultimo_fim
              FROM evento_participantes ep
              JOIN eventos e ON e.id_evento = ep.id_evento
              JOIN usuario u ON u.id_usuario = ep.{schema['user_col']}
             WHERE e.horario_termino < NOW()
               AND ep.{schema['user_col']} <> %s
               AND e.horario_termino >= DATE_SUB(NOW(), INTERVAL 120 DAY)
             GROUP BY u.id_usuario, u.nome_user
             ORDER BY ultimo_fim DESC
             LIMIT 40
            """,
            (uid,),
        )
        rows = cursor.fetchall()
        for r in rows:
            if r.get("ultimo_fim") and hasattr(r["ultimo_fim"], "strftime"):
                r["ultimo_fim"] = r["ultimo_fim"].strftime("%Y-%m-%d %H:%M:%S")
    except mysql.connector.Error:
        rows = []
    cursor.close()
    db.close()
    return jsonify({"success": True, "jogadores": rows})


@app.route("/api/eventos/<int:event_id>/avaliar-participantes", methods=["POST"])
def api_avaliar_participantes_evento(event_id):
    _ensure_runtime_schema()
    criador = _current_user_id(require=True)
    if not criador:
        return jsonify({"success": False, "message": "Faça login."}), 401
    dados = request.get_json() or {}
    avaliacoes = dados.get("avaliacoes")
    if not isinstance(avaliacoes, list) or not avaliacoes:
        return jsonify({"success": False, "message": "Envie avaliacoes: [{jogador_id, gols, nota, comentario?}]"}), 400
    db = conectar_banco()
    if db is None:
        return jsonify({"success": False, "message": "Erro conexão banco"}), 500
    cursor = db.cursor(dictionary=True)
    if not _table_exists(cursor, "evento_avaliacao_criador"):
        cursor.close()
        db.close()
        return jsonify({"success": False, "message": "Execute migrations_bigstret_v2.sql (tabela de avaliações)."}), 503
    try:
        cursor.execute(
            "SELECT usuario_id, horario_termino, data_evento FROM eventos WHERE id_evento=%s",
            (event_id,),
        )
        ev = cursor.fetchone()
        if not ev:
            cursor.close()
            db.close()
            return jsonify({"success": False, "message": "Evento não encontrado."}), 404
        if int(ev["usuario_id"]) != int(criador):
            cursor.close()
            db.close()
            return jsonify({"success": False, "message": "Apenas o criador pode avaliar."}), 403
        if not _evento_finalizado(ev):
            cursor.close()
            db.close()
            return jsonify({"success": False, "message": "Só é possível avaliar após o fim do evento."}), 400
        jogadores_atualizados = set()
        for item in avaliacoes:
            try:
                jid = int(item.get("jogador_id"))
            except (TypeError, ValueError):
                continue
            if jid == int(criador):
                continue
            gols = int(item.get("gols") or 0)
            nota = float(item.get("nota") or 4.0)
            nota = max(1.0, min(5.0, nota))
            gols = max(0, min(50, gols))
            com = (item.get("comentario") or "")[:255]
            cursor.execute(
                "SELECT gols FROM evento_avaliacao_criador WHERE id_evento=%s AND jogador_id=%s",
                (event_id, jid),
            )
            prev = cursor.fetchone()
            old_gols = int(prev["gols"]) if prev else 0
            cursor.execute(
                """
                INSERT INTO evento_avaliacao_criador (id_evento, jogador_id, gols, nota, comentario)
                VALUES (%s, %s, %s, %s, %s)
                ON DUPLICATE KEY UPDATE gols=VALUES(gols), nota=VALUES(nota), comentario=VALUES(comentario)
                """,
                (event_id, jid, gols, nota, com or None),
            )
            delta_gols = gols - old_gols
            if delta_gols:
                cursor.execute(
                    "UPDATE usuario SET gols = COALESCE(gols,0) + %s WHERE id_usuario=%s",
                    (delta_gols, jid),
                )
            jogadores_atualizados.add(jid)
        for jid in jogadores_atualizados:
            _get_user_reputation_snapshot(cursor, jid, persist=True)
        db.commit()
        cursor.close()
        db.close()
        return jsonify({"success": True, "message": "Avaliações registradas."})
    except mysql.connector.Error as e:
        db.rollback()
        cursor.close()
        db.close()
        return jsonify({"success": False, "message": str(e)}), 400


@app.route("/api/eventos/<int:event_id>/avaliacoes-criador", methods=["GET"])
def api_listar_avaliacoes_evento(event_id):
    uid = _current_user_id(require=True)
    if not uid:
        return jsonify({"success": False, "message": "Faça login."}), 401
    db = conectar_banco()
    if db is None:
        return jsonify({"success": False, "message": "Erro conexão banco"}), 500
    cursor = db.cursor(dictionary=True)
    if not _table_exists(cursor, "evento_avaliacao_criador"):
        cursor.close()
        db.close()
        return jsonify({"success": True, "avaliacoes": []})
    cursor.execute(
        "SELECT usuario_id FROM eventos WHERE id_evento=%s",
        (event_id,),
    )
    ev = cursor.fetchone()
    if not ev or int(ev["usuario_id"]) != int(uid):
        cursor.close()
        db.close()
        return jsonify({"success": False, "message": "Sem permissão."}), 403
    cursor.execute(
        """
        SELECT a.jogador_id, a.gols, a.nota, a.comentario, u.nome_user
          FROM evento_avaliacao_criador a
          JOIN usuario u ON u.id_usuario = a.jogador_id
         WHERE a.id_evento=%s
        """,
        (event_id,),
    )
    rows = cursor.fetchall()
    cursor.close()
    db.close()
    return jsonify({"success": True, "avaliacoes": rows})


# ---------------- MAIN ---------------- #

if __name__ == '__main__':
    app.run(debug=True)
