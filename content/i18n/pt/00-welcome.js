registerLessonI18nSrc("00-how-this-course-works", "pt", function () {/*
---
id: 00-how-this-course-works
title: Como Este Curso Funciona
minutes: 10
level: beginner
objectives:
  - Compreender a estrutura que leva você do zero a engenheiro principal
  - Saber como executar código direto no seu navegador
  - Aprender a aproveitar ao máximo cada lição
---

# Como Este Curso Funciona

## Por que isso importa

Você está prestes a aprender Node.js da maneira que um grande mentor ensinaria: devagar o suficiente para que nada seja confuso, mas com profundidade suficiente para que, ao final, você possa projetar sistemas que atendam a milhões de usuários. Antes de tocar em uma única linha de Node, vamos passar dez minutos garantindo que você sabe como *usar* este curso. Um pequeno investimento agora vai poupar horas mais tarde.

## Objetivos de aprendizado

- Compreender a jornada desde iniciante absoluto até **engenheiro principal distinto (Nível 7+)**.
- Executar JavaScript diretamente nesta página — sem necessidade de instalação para começar.
- Saber exatamente para que serve cada parte de uma lição.

## A forma da jornada

Este curso está organizado em **seis níveis**. Cada nível é construído sobre o anterior, como andares de um prédio. Você não deve pular andares — o material avançado literalmente não faz sentido sem as bases.

| Nível | No que você se torna |
|-------|----------------------|
| **Nível 0 — Orientação** | Configurar e executar Node como um profissional |
| **Nível 1 — Fundamentos** | Fluente em JavaScript e no ambiente de execução do Node |
| **Nível 2 — APIs Principais** | Capaz de usar cada módulo principal do Node |
| **Nível 3 — Construindo Coisas Reais** | Publicando CLIs, APIs e aplicações com banco de dados |
| **Nível 4 — Qualidade de Engenharia** | TypeScript, testes, ferramentas, monorepos |
| **Nível 5 — Avançado e Principal** | Sistemas distribuídos, desempenho, arquitetura |

> [!NOTE] Você sempre pode ver onde está
> A barra lateral à esquerda é o seu mapa. Seu progresso é salvo automaticamente neste navegador, e a barra no topo mostra o quanto você avançou. Use os botões **Próximo →** e **← Anterior** no final de cada lição, ou simplesmente pressione as teclas de seta.

## Execute código sem instalar nada

A maioria dos blocos de código neste curso são **interativos**. Quando você vir um botão verde **▶ Executar**, você pode editar o código e executá-lo instantaneamente — ele é executado com segurança dentro do seu navegador. Experimente agora:

~~~js run
// Edite-me! Depois pressione ▶ Executar.
const name = "future principal engineer";
console.log("Hello, " + name + "!");

// JavaScript também pode fazer trabalho real:
const numbers = [1, 2, 3, 4, 5];
const total = numbers.reduce((sum, n) => sum + n, 0);
console.log("The sum is:", total);
~~~

Vá em frente — mude o nome, mude os números e execute novamente. Experimentar é como se aprende. Você não pode quebrar nada.

> [!PITFALL] "Interativo" significa JavaScript do navegador
> Os blocos com **▶ Executar** executam *JavaScript puro* no seu navegador. Algumas lições mostram código que usa recursos específicos do Node — leitura de arquivos, inicialização de servidores web, conexão com bancos de dados — que um navegador não consegue fazer. Esses exemplos são **somente leitura** e vêm com um painel de **Saída esperada** para que você veja exatamente o que aconteceria ao executá-los no Node real. Você instalará o Node real nas próximas duas lições.

## Anatomia de uma lição

Cada lição segue o mesmo ritmo, para que você sempre saiba o que esperar:

1. **Por que isso importa** — o motivo do mundo real para se importar.
2. **Objetivos de aprendizado** — o que você será capaz de fazer.
3. **Conceito** — explicação em linguagem simples, construída do zero.
4. **Explicação narrada** — código anotado que você lê linha por linha.
5. **Experimente você mesmo** — um ambiente de execução para experimentar.
6. **Exercícios** — pequenos desafios com dicas e soluções reveladas.
7. **Projeto** — algo real que você constrói com o que aprendeu.
8. **Armadilhas** — os erros que até desenvolvedores experientes cometem.
9. **O que você aprendeu** + **Próximos passos**.

## Como realmente melhorar

> [!PRINCIPAL] O único hábito que cria engenheiros principais
> Ler código ensina você a *reconhecer* soluções. **Escrever** código ensina você a *produzi-las*. A diferença entre um engenheiro de nível médio e um engenheiro principal são principalmente milhares de horas de prática deliberada. Portanto, para cada conceito: digite, execute, quebre de propósito e corrija. Faça cada exercício. Construa cada projeto. Não se limite a ler.

Aqui está um pequeno exercício para provar que você está pronto.

### Exercício: torne-o seu

Edite o código abaixo para que ele imprima uma contagem regressiva de 5 até 1, depois imprima "Lift off!".

~~~js run
// Sua vez. Dica: um laço que conta para baixo.
for (let i = 5; i >= 1; i--) {
  console.log(i);
}
console.log("Lift off!");
~~~

<details>
<summary>Mostrar uma possível solução</summary>

O código acima já funciona — mas tente escrevê-lo de uma maneira diferente, usando `while` em vez de `for`:

~~~js run
let i = 5;
while (i >= 1) {
  console.log(i);
  i = i - 1;
}
console.log("Lift off!");
~~~

Raramente existe apenas uma resposta correta em programação. Sentir-se confortável com *múltiplas* formas de expressar a mesma ideia é um sinal de que você está crescendo.
</details>

## O que você aprendeu

- Este curso sobe seis níveis desde iniciante até engenheiro principal — percorra-os em ordem.
- Blocos verdes com **▶ Executar** são executados ao vivo; blocos somente leitura mostram código exclusivo do Node com a saída esperada.
- Seu progresso é salvo automaticamente; navegue com os botões ou as teclas de seta.
- A maneira de melhorar é **escrever** código, não apenas lê-lo.

## Próximos passos

A seguir, instalaremos o Node.js da maneira que os profissionais fazem — com um gerenciador de versões — para que você possa executar tudo neste curso na sua própria máquina.
*/});

registerLessonI18nSrc("00-installing-node", "pt", function () {/*
---
id: 00-installing-node
title: Instalando Node do Jeito Profissional
minutes: 16
level: beginner
objectives:
  - Instalar o Node.js usando um gerenciador de versões em vez do instalador direto
  - Compreender LTS vs Current e qual escolher
  - Verificar sua instalação e alternar entre versões
---

# Instalando Node do Jeito Profissional (nvm / fnm / Volta)

## Por que isso importa

Você *poderia* baixar o Node de nodejs.org e clicar duas vezes em um instalador. Iniciantes fazem isso. Profissionais não — e aqui está o motivo: projetos reais fixam versões diferentes do Node. O aplicativo de um cliente precisa do Node 20, outro precisa do Node 24. Uma única instalação global significa dor constante. Um **gerenciador de versões** permite que você instale muitas versões do Node lado a lado e alterne com um único comando. Configurar isso agora é a diferença entre uma carreira tranquila e anos de dores de cabeça com "funciona na minha máquina".

## Objetivos de aprendizado

- Instalar um gerenciador de versões do Node apropriado para o seu sistema operacional.
- Compreender as linhas de lançamento **LTS** vs **Current**.
- Confirmar que o Node e o npm estão funcionando e alternar versões sob demanda.

## LTS vs Current: qual versão?

O Node lança duas linhas de versões:

- **LTS (Suporte de Longo Prazo)** — versões principais com números pares (20, 22, **24**...). Estável, com suporte por ~3 anos, e o que você deve usar em produção. Em meados de 2026, **o Node 24 é o LTS ativo**.
- **Current** — os recursos mais recentes, mas com suporte mais curto. Ótimo para experimentar APIs de ponta.

> [!NOTE] Nossa regra geral
> Use o **LTS** mais recente para tudo neste curso. Você obtém recursos modernos (`fetch` nativo, o executor de testes integrado, suporte nativo a `.env`, o modelo de permissões) *e* estabilidade.

## Escolha um gerenciador de versões

Há três ótimas opções. Qualquer uma delas é boa — escolha uma.

| Ferramenta | Ideal para | Observações |
|------------|------------|-------------|
| **fnm** | A maioria das pessoas | Extremamente rápido, multiplataforma, escrito em Rust |
| **nvm** | Tradicionalistas de macOS / Linux | O original; enorme comunidade |
| **Volta** | Equipes que querem ferramentas fixadas | Fixa o Node *e* gerenciadores de pacotes por projeto |

### Opção A — fnm (recomendado)

No macOS ou Linux:

~~~bash
# Instalar fnm
curl -fsSL https://fnm.vercel.app/install | bash

# Reinicie seu terminal, depois instale e use o LTS mais recente
fnm install --lts
fnm use --lts
fnm default lts-latest
~~~

No Windows (PowerShell, com winget):

~~~bash
winget install Schniz.fnm
fnm install --lts
fnm use --lts
~~~

### Opção B — nvm (macOS / Linux)

~~~bash
# Instalar nvm
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash

# Reinicie seu terminal, depois:
nvm install --lts
nvm use --lts
nvm alias default 'lts/*'
~~~

### Opção C — Volta (multiplataforma, fixa por projeto)

~~~bash
curl https://get.volta.sh | bash
volta install node@lts
~~~

## Verifique se funcionou

Abra um terminal **novo** e execute estes dois comandos. (Estes são comandos reais de terminal — execute-os na sua própria máquina, não no navegador.)

~~~bash
node --version
npm --version
~~~

Você deve ver algo assim:

> [!OUTPUT]
> v24.2.0
> 11.3.0

Se você vir números de versão, está pronto — o Node *e* o npm (que vem incluído com o Node) estão instalados. 🎉

## Alternar versões agora é trivial

Este é o benefício. Quer testar seu código em um Node mais antigo?

~~~bash
# Instalar e alternar para o Node 20 por um momento
fnm install 20
fnm use 20
node --version   # v20.x.x

# Voltar para o LTS mais recente
fnm use --lts
~~~

> [!PRINCIPAL] Fixe o Node por projeto
> Adicione um arquivo chamado `.nvmrc` (ou `.node-version`) a cada projeto contendo apenas a versão, por exemplo `24`. Então `fnm use` ou `nvm use` (sem argumento) lê esse arquivo e alterna automaticamente. Melhor ainda, o Volta registra a versão exata dentro do `package.json` para que *cada* membro da equipe execute o mesmo Node sem precisar pensar nisso. Reprodutibilidade é um valor de engenheiro principal — e começa aqui.

## Armadilhas

> [!PITFALL] "Comando não encontrado" após a instalação
> Quase sempre isso significa que seu shell ainda não carregou o gerenciador de versões. **Feche e reabra seu terminal** (ou execute `source ~/.bashrc` / `source ~/.zshrc`). O instalador imprime a linha exata a ser adicionada à configuração do seu shell — leia essa saída.

> [!WARNING] Não misture uma instalação manual com um gerenciador de versões
> Se você instalou o Node anteriormente pelo site, desinstale-o primeiro. Duas instalações do Node brigando pelo seu `PATH` causa bugs desconcertantes. Deixe o gerenciador de versões ser o dono do Node por completo.

## O que você aprendeu

- Profissionais gerenciam o Node com **fnm / nvm / Volta**, nunca com uma única instalação global.
- Use o **LTS** mais recente (Node 24 em 2026) para a melhor combinação de recursos e estabilidade.
- `node --version` e `npm --version` confirmam sua configuração.
- Fixar uma versão por projeto mantém toda a sua equipe sincronizada.

## Próximos passos

Você tem o Node instalado. A seguir, você escreverá e executará seu primeiro programa — de três maneiras diferentes — e conhecerá o REPL, seu novo melhor amigo para experimentos rápidos.
*/});

registerLessonI18nSrc("00-your-first-program", "pt", function () {/*
---
id: 00-your-first-program
title: Seu Primeiro Programa
minutes: 18
level: beginner
objectives:
  - Executar JavaScript no REPL do Node para experimentos instantâneos
  - Executar um script a partir de um arquivo como os programas reais fazem
  - Usar --eval e --print para comandos de uma linha
  - Construir e executar seu primeiro script real de três maneiras diferentes
---

# Seu Primeiro Programa: REPL, Arquivos e --eval

## Por que isso importa

Há três maneiras de executar código com o Node, e cada uma tem um propósito. O **REPL** é para experimentos rápidos. **Arquivos** são como os programas reais são publicados. **`--eval`** é para pequenas linhas de comando e scripts de shell. Um profissional escolhe a correta sem precisar pensar. Ao final desta lição, você terá executado código das três maneiras e construído seu primeiro script genuinamente útil.

## Objetivos de aprendizado

- Usar o **REPL** para testar ideias instantaneamente.
- Executar um programa a partir de um **arquivo `.js`**.
- Usar **`--eval`** e **`--print`** para comandos rápidos.
- Construir um pequeno script "saudador do sistema".

## Maneira 1 — O REPL (seu campo de testes instantâneo)

REPL significa **Read-Eval-Print Loop** (Laço Ler-Avaliar-Imprimir). Digite `node` sem argumentos e você obterá um prompt interativo que lê o que você digita, avalia, imprime o resultado e repete:

~~~bash
node
~~~

Agora você está dentro do Node. Digite uma expressão e pressione Enter:

> [!OUTPUT]
> > 2 + 2
> 4
> > const greeting = "hello"
> undefined
> > greeting.toUpperCase()
> 'HELLO'
> > .exit

Algumas coisas a notar:
- O Node imprime o **resultado** de cada expressão automaticamente (esse é o "Print" no REPL).
- `const greeting = ...` imprime `undefined` porque uma *declaração de atribuição* não tem valor — mas a variável agora está memorizada.
- Digite `.exit` (ou pressione Ctrl+D) para sair.

> [!NOTE] O REPL é para *aprender*, não para *construir*
> É perfeito para momentos de "o que essa função retorna mesmo?". Mas você não pode salvá-lo, então programas reais vivem em arquivos.

Você pode experimentar um laço similar ao REPL aqui mesmo no seu navegador. Cada `console.log` é como pressionar Enter no REPL:

~~~js run
console.log(2 + 2);
const greeting = "hello";
console.log(greeting.toUpperCase());
console.log(typeof greeting);
~~~

## Maneira 2 — Executar um arquivo (como os programas reais são publicados)

Crie um arquivo chamado `hello.js` com este conteúdo:

~~~js
console.log("Hello from a real file!");

const now = new Date();
console.log("The time is:", now.toLocaleTimeString());
~~~

Depois execute-o a partir do seu terminal:

~~~bash
node hello.js
~~~

> [!OUTPUT]
> Hello from a real file!
> The time is: 3:42:18 PM

É isso — é assim que todo programa Node no mundo começa. Um arquivo, e `node` na frente dele.

> [!PRINCIPAL] --watch: re-execução automática ao salvar
> O Node moderno tem um modo de observação integrado. Execute `node --watch hello.js` e o Node reexecuta o arquivo toda vez que você o salva. Nenhuma ferramenta adicional necessária — isso costumava requerer um pacote chamado *nodemon*. Usaremos `--watch` constantemente mais adiante no curso.

## Maneira 3 — --eval e --print (linhas de comando)

Às vezes você quer apenas uma linha de JavaScript sem criar um arquivo — útil em scripts de shell:

~~~bash
# --eval (ou -e) executa o código mas não imprime automaticamente
node --eval "console.log(1 + 1)"

# --print (ou -p) imprime automaticamente o resultado da expressão
node -p "process.platform"
node -p "Math.max(3, 9, 2)"
~~~

> [!OUTPUT]
> 2
> linux
> 9

Note `process.platform` — esse é seu primeiro contato com o objeto **`process`** do Node, que conhece tudo sobre o programa em execução e a máquina em que ele está. Vamos explorá-lo profundamente no Nível 1.

## Projeto: seu primeiro script real

Vamos construir um **saudador do sistema** — um script que imprime um banner amigável e personalizado. Este usa o módulo integrado `os` do Node, portanto é um exemplo somente leitura aqui (um navegador não tem sistema operacional para inspecionar), mas você pode copiá-lo em um arquivo e executá-lo de verdade.

~~~js
// greeter.js — executar com: node greeter.js
import os from "node:os";

const user = os.userInfo().username;
const platform = os.platform();          // 'darwin', 'linux', 'win32'
const cpus = os.cpus().length;            // número de núcleos de CPU
const memGB = (os.totalmem() / 1e9).toFixed(1);

console.log("============================================");
console.log("  Welcome back, " + user + "!");
console.log("--------------------------------------------");
console.log("  Platform : " + platform);
console.log("  CPU cores: " + cpus);
console.log("  Memory   : " + memGB + " GB");
console.log("  Node     : " + process.version);
console.log("============================================");
~~~

Quando você executá-lo na sua própria máquina, verá algo como:

> [!OUTPUT]
> ============================================
>   Welcome back, ada!
> --------------------------------------------
>   Platform : linux
>   CPU cores: 8
>   Memory   : 16.6 GB
>   Node     : v24.2.0
> ============================================

### Faça das três maneiras

Prove que você entende os três métodos de execução:

1. **Arquivo:** salve como `greeter.js` e execute `node greeter.js`.
2. **Watch:** execute `node --watch greeter.js` e edite o banner — veja-o ser reexecutado.
3. **Linha de comando:** execute `node -p "require('node:os').userInfo().username"` para imprimir apenas seu nome de usuário.

### Exercício: a lógica, no navegador

A lógica de construção do banner é JavaScript puro. Pratique aqui sem o módulo `os` usando valores fictícios:

~~~js run
// Construa a string do banner você mesmo.
const user = "ada";
const platform = "linux";
const cores = 8;

const line = "============================================";
console.log(line);
console.log("  Welcome back, " + user + "!");
console.log("  Platform: " + platform + " | Cores: " + cores);
console.log(line);
~~~

<details>
<summary>Desafio: use um template literal em vez de concatenação com +</summary>

~~~js run
const user = "ada";
const platform = "linux";
const cores = 8;

// Template literals usam backticks e ${...} para interpolação.
console.log(`  Welcome back, ${user}! Running ${platform} on ${cores} cores.`);
~~~

Template literals são mais limpos do que juntar strings com `+`. Você os usará em todo lugar.
</details>

## Armadilhas

> [!PITFALL] Esquecer a extensão do arquivo ou a palavra "node"
> É `node hello.js`, não `hello.js` (isso pediria ao seu sistema operacional para executar o arquivo diretamente) e não `node hello` (o Node não vai adivinhar a extensão para um caminho de script simples). Digite tudo completo.

## O que você aprendeu

- O **REPL** (`node`) é para experimentos instantâneos.
- Executar um **arquivo** (`node file.js`) é como os programas reais são publicados — e `--watch` o reexecuta ao salvar.
- **`--eval`** e **`--print`** lidam com linhas de comando rápidas.
- Você conheceu os objetos **`process`** e **`os`**, sua janela para a máquina em execução.

## Próximos passos

Agora você pode executar o Node de todas as maneiras que importam. O Nível 1 começa com uma revisão de JavaScript — a linguagem sobre a qual o Node é construído. Mesmo que você já conheça um pouco de JavaScript, não pule: focamos exatamente nas partes que fazem o Node fazer sentido.
*/});
