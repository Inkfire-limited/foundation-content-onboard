(function ($) {
  "use strict";

  // VERSION CHECK
  // The hub supplies project-scoped access and persistence.

  const App = {
    data: null,
    activeId: null, // Current Page ID
    activeTab: "pages", // pages, setup, branding, team, blog, shop
    saveTimer: null,
    wizardState: {},
    wpEditorId: null,
    lastWizardRenderKey: null,

    COMMON_PAGES: [
      "Home", "About", "Services", "Contact", "Blog", "Shop",
      "Privacy Policy", "Terms", "FAQ", "Portfolio", "Careers", "Team"
    ],

    // REDUCED TO 6 SWATCHES AS REQUESTED
    BRAND_SWATCHES: [
      { name: "Primary", hex: "#4f46e5", pantone: "" },
      { name: "Secondary", hex: "#0ea5e9", pantone: "" },
      { name: "Accent", hex: "#22c55e", pantone: "" },
      { name: "Text", hex: "#0f172a", pantone: "" },
      { name: "Background", hex: "#ffffff", pantone: "" },
      { name: "Border", hex: "#e2e8f0", pantone: "" }
    ],

    // ------------------------------------------------------------
    // INIT
    // ------------------------------------------------------------
    init: async function () {
      this.restorePortalHeader();
      if (!window.FCO_Config || !FCO_Config.api) {
        $("#fco-client-app").html('<div class="fco-error">Missing Configuration (FCO_Config).</div>');
        return;
      }

      // UX Pack: Inject busy style if not present
      if ($("#fco-ux-style").length === 0) {
          $("head").append(`<style id="fco-ux-style">.fco-btn.is-busy { opacity:0.7; pointer-events:none; cursor:wait !important; }</style>`);
      }

      // Prefer config pages list if supplied
      if (Array.isArray(FCO_Config.commonPages) && FCO_Config.commonPages.length) {
        this.COMMON_PAGES = FCO_Config.commonPages;
      }

      this.applyResponsiveClass();
      $(window).on("resize", () => this.applyResponsiveClass());

      this.guardAdminForm();

      // Close dropdowns on outside click
      $(document).on("click", (e) => {
        if (!$(e.target).closest(".fco-dropdown").length) $(".fco-dropdown-menu").removeClass("show");
        // Close new menu
        if (!$(e.target).closest("#fco-menu-toggle, #fco-main-menu").length) $("#fco-main-menu").removeClass("show");
      });

      await this.loadProject();
    },

    applyResponsiveClass: function () {
      $("body").toggleClass("fco-mobile", $(window).width() < 1000);
    },

    guardAdminForm: function () {
      if ($("body.wp-admin").length === 0) return;

      $("form#post").on("submit", function (e) {
        const submitter = e.originalEvent && e.originalEvent.submitter ? e.originalEvent.submitter : null;
        if (submitter && $(submitter).closest("#fco-client-app").length) {
          e.preventDefault();
          e.stopPropagation();
          return false;
        }
      });
    },

    // ------------------------------------------------------------
    // API HELPERS
    // ------------------------------------------------------------
    apiGet: function (path, data = {}) {
      data._cb = new Date().getTime(); // Explicit cache buster
      return $.ajax({
        url: `${FCO_Config.api.root}${path}`,
        method: "GET",
        data,
        cache: false,
        beforeSend: (xhr) => xhr.setRequestHeader("X-WP-Nonce", FCO_Config.api.nonce)
      });
    },

    apiPost: function (path, payload = {}) {
      return $.ajax({
        url: `${FCO_Config.api.root}${path}`,
        method: "POST",
        contentType: "application/json",
        data: JSON.stringify(payload),
        beforeSend: (xhr) => xhr.setRequestHeader("X-WP-Nonce", FCO_Config.api.nonce)
      });
    },

    // ------------------------------------------------------------
    // DATA LOAD + MODE
    // ------------------------------------------------------------
    loadProject: async function () {
      try {
        let res = await this.apiGet("/project/current", { project_id: FCO_Config.projectId });
        
        // Safety: Handle if response is a string
        if (typeof res === "string") {
            try { res = JSON.parse(res); } catch (e) { console.warn("Failed to parse response", e); }
        }

        this.data = res || {};

        // 1. Core Objects
        this.data.project = this.data.project || {};
        this.data.branding = this.data.branding || {};
        this.data.content = this.data.content || {}; 
        this.data.pages = Array.isArray(this.data.pages) ? this.data.pages : [];
        this.data.drafts = this.data.drafts || {};
        // Ensure comments object exists
        this.data.comments = Object.assign({}, this.data.comments || {});
        this.data._provenance = (this.data._provenance && typeof this.data._provenance === "object" && !Array.isArray(this.data._provenance)) ? this.data._provenance : {};
        this.data._provenance.sections = (this.data._provenance.sections && typeof this.data._provenance.sections === "object" && !Array.isArray(this.data._provenance.sections)) ? this.data._provenance.sections : {};
        this.data._provenance.defaults = (this.data._provenance.defaults && typeof this.data._provenance.defaults === "object" && !Array.isArray(this.data._provenance.defaults)) ? this.data._provenance.defaults : {};

        // 2. Branding Sub-properties
        this.data.branding.assets = Array.isArray(this.data.branding.assets) ? this.data.branding.assets : [];
        this.data.branding.inspiration_links = Array.isArray(this.data.branding.inspiration_links) ? this.data.branding.inspiration_links : ["", "", "", "", "", ""]; // 6 links for Task 6
        this.data.branding.socials = Array.isArray(this.data.branding.socials) ? this.data.branding.socials : [];
        this.data.branding.contact = this.data.branding.contact || { address: "", emails: [], phones: [] };
        
        this.data.branding.fonts = Array.isArray(this.data.branding.fonts) ? this.data.branding.fonts : [
          { label: "Primary", name: "", url: "" },
          { label: "Secondary", name: "", url: "" },
          { label: "Tertiary", name: "", url: "" },
          { label: "Other", name: "", url: "" }
        ];

        this.data.branding.colors = Array.isArray(this.data.branding.colors) ? this.data.branding.colors : [];
        if (!this.data.branding.colors.length) {
          this.data.branding.colors = JSON.parse(JSON.stringify(this.BRAND_SWATCHES));
          this.data._provenance.defaults.brand_colors = true;
        }

        // 3. Content Sub-properties
        this.data.content.staff = Array.isArray(this.data.content.staff) ? this.data.content.staff : [];
        this.data.project.wp_users = Array.isArray(this.data.project.wp_users) ? this.data.project.wp_users : [];

        // 4. Mode Switching
        if (FCO_Config.isAdmin) {
          this.switchMode("editor");
        } else if (this.data.project.wizard_complete) {
          this.switchMode("editor");
        } else {
          this.switchMode("start");
        }
      } catch (e) {
        console.error("FCO Load Error:", e);
        let msg = e.message || "Unknown error";
        if (e.status) msg += ` (Status: ${e.status})`;
        $("#fco-client-app").html(`<div class="fco-error">Error loading project: ${this.escapeHtml(msg)} <br>Check console for details.</div>`);
      }
    },

    // Move the existing controls so their listeners and accessible names survive.
    restorePortalHeader: function () {
      const $home = $('.fco-sitebar-actions');
      if (!$home.length) return;
      $('#fco-project-label, #fco-help-open, #fco-signout').detach().appendTo($home);
      $home.find('.fco-step-picker-label').remove();
      document.body.classList.remove('fco-wizard-header-active');
    },

    mountWizardHeader: function ($root) {
      const $home = $('.fco-sitebar-actions');
      if (!$home.length) return;
      $root.find('.fco-step-picker-label').detach().appendTo($home);
      $root.find('.fco-wizard-brand').empty().append($('<span>', {class:'fco-wizard-eyebrow',text:'Inkfire website onboarder'}), $('#fco-project-label').detach());
      $('#fco-help-open, #fco-signout').detach().appendTo($root.find('.fco-wizard-top-actions'));
      document.body.classList.add('fco-wizard-header-active');
    },

    switchMode: function (mode) {
      this.flushPendingInputs?.();
      this.restorePortalHeader();
      this.destroyWpEditor();

      const $root = $("#fco-client-app");
      $root.attr("class", "").addClass(`mode-${mode}`);
      $root.empty();

      if (mode === "start") this.renderStart($root);
      if (mode === "wizard") this.renderWizard($root);
      if (mode === "editor") this.renderEditor($root);
    },

    // ------------------------------------------------------------
    // START SCREEN
    // ------------------------------------------------------------
    renderStart: function ($el) {
      const name = window.FCO_HubBridge?.context?.contact_name || FCO_Config.user?.name || "there";

      $el.html(`
        <div class="fco-start-hero">
          <div class="fco-start-kicker">Welcome, ${this.escapeHtml(name)}</div>
          <h1 class="fco-start-title">Let’s build your foundation.</h1>
          <p class="fco-start-sub">
            We’ll collect your branding, structure your content, team info, and set up your store if needed.
          </p>
          <div class="fco-start-actions">
            <button class="fco-btn primary large" id="btn-begin">
              Start Onboarding <span aria-hidden="true">→</span>
            </button>
            <button class="fco-btn ghost large" id="btn-skip">
              Skip to Dashboard
            </button>
          </div>
        </div>
      `);

      $("#btn-begin").on("click", (e) => { e.preventDefault(); this.switchMode("wizard"); });
      $("#btn-skip").on("click", (e) => { e.preventDefault(); this.switchMode("editor"); });
    },

    // ------------------------------------------------------------
    // EDITOR DASHBOARD (MAIN)
    // ------------------------------------------------------------
    renderEditor: function ($el) {
      const isAdmin = !!FCO_Config.isAdmin;
      const compName = this.data.branding.company_name || this.data.project.company_name || "Project";
      // HARDCODED LOGO PATH (Editor)
      const logoUrl = FCO_Config.pluginUrl + "assets/v3/inkfire-mark.png";
      
      $el.html(`
        <div class="fco-portal-wrap">
          <header class="fco-header">
            <div class="fco-head-left">
              <div class="fco-logo-mark" aria-hidden="true">
                  <img src="${logoUrl}" alt="Inkfire logo" style="width:100%; height:100%; object-fit:contain; border-radius:inherit;">
              </div>
              <div class="fco-head-titles">
                <div class="fco-head-title">Inkfire Website Onboarder</div>
                <div class="fco-head-sub">${this.escapeHtml(compName)}</div>
              </div>
            </div>
            <div class="fco-head-right">
              <div class="fco-head-actions">
                <button class="fco-menu-btn" id="fco-menu-toggle" aria-label="Menu" title="Options">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="3" y1="12" x2="21" y2="12"></line><line x1="3" y1="6" x2="21" y2="6"></line><line x1="3" y1="18" x2="21" y2="18"></line></svg>
                </button>
                
                <!-- HAMBURGER DROPDOWN -->
                <div class="fco-menu-dropdown" id="fco-main-menu">
                    ${isAdmin ? `
                        <button class="fco-menu-item" id="btn-export">Export JSON</button>
                        <label class="fco-file-menu-item"><span class="fco-menu-item">Import JSON</span><input type="file" id="btn-import" accept=".json" style="display:none;"></label>
                        <button class="fco-menu-item danger" id="btn-reset-wiz">Reset Wizard</button>
                    ` : ``}
                    <button class="fco-menu-item" id="btn-open-wiz">Open Wizard</button>
                </div>
              </div>
              ${isAdmin ? '<div class="fco-save-indicator" aria-live="polite">Saved</div>' : ''}
            </div>
          </header>

          <div class="fco-toolbar">
              <nav class="fco-tab-nav">
                 <button class="fco-tab-btn ${this.activeTab === 'pages' ? 'active' : ''}" data-tab="pages">Pages</button>
                 <button class="fco-tab-btn ${this.activeTab === 'setup' ? 'active' : ''}" data-tab="setup">Setup</button>
                 <button class="fco-tab-btn ${this.activeTab === 'branding' ? 'active' : ''}" data-tab="branding">Branding</button>
                 <button class="fco-tab-btn ${this.activeTab === 'team' ? 'active' : ''}" data-tab="team">Team</button>
                 <button class="fco-tab-btn ${this.activeTab === 'blog' ? 'active' : ''}" data-tab="blog">Blog</button>
                 <button class="fco-tab-btn ${this.activeTab === 'shop' ? 'active' : ''}" data-tab="shop">Shop</button>
              </nav>
          </div>
          
          <div class="fco-stage" id="fco-tab-stage">
            </div>
        </div>
      `);

      $("#btn-open-wiz").on("click", () => this.switchMode("wizard"));
      
      // Menu Toggle Logic
      $("#fco-menu-toggle").on("click", (e) => {
          e.stopPropagation();
          $("#fco-main-menu").toggleClass("show");
      });

      $(".fco-tab-btn").on("click", (e) => {
         const t = $(e.currentTarget).data("tab");
         this.activeTab = t;
         $(".fco-tab-btn").removeClass("active");
         $(e.currentTarget).addClass("active");
         this.renderTabContent(); 
      });

      if (isAdmin) {
        $("#btn-export").on("click", () => this.exportJson());
        $("#btn-import").on("change", (e) => this.importJson(e));

        // RESET WIZARD BUTTON LOGIC
        $("#btn-reset-wiz").on("click", () => {
            if(!confirm("Reset Wizard Status?\n\nThis will force the client to see the start screen/wizard again.\n\nNO DATA WILL BE DELETED.")) return;
            this.data.project.wizard_complete = false;
            this.saveData(true).then(() => {
                alert("Wizard status reset. Reloading...");
                window.location.reload();
            });
        });
      }

      this.renderTabContent();
    },

    renderTabContent: function() {
        const $stage = $("#fco-tab-stage");
        $stage.empty();
        this.destroyWpEditor();

        if (this.activeTab === "pages") {
            this.renderPagesTab($stage);
        } else if (this.activeTab === "setup") {
            this.renderSetupTab($stage);
        } else if (this.activeTab === "branding") {
            this.renderBrandingTab($stage);
        } else if (this.activeTab === "team") {
            this.renderTeamTab($stage);
        } else if (this.activeTab === "blog") {
            this.renderBlogTab($stage);
        } else if (this.activeTab === "shop") {
            this.renderShopTab($stage);
        }
        // Each dashboard view has one page-level heading. Keep its existing design.
        const sectionNames = {setup:'Website setup',branding:'Branding',team:'Team members',blog:'Blog and news',shop:'Online shop'};
        if (sectionNames[this.activeTab]) $stage.prepend(`<h1 class="fco-a11y-only">${sectionNames[this.activeTab]}</h1>`);
    },

    // ------------------------------------------------------------
    // TAB: PAGES (Original Editor)
    // ------------------------------------------------------------
    renderPagesTab: function($stage) {
        const isAdmin = !!FCO_Config.isAdmin;
        const canStructure = isAdmin || !!FCO_Config.clientCanEditStructure;
        
        // REMOVED THE ASIDE PANEL FROM THE GRID
        $stage.html(`
          <div class="fco-grid">
            <aside class="fco-sidebar">
              ${canStructure ? `<div class="fco-tree-controls"><button class="fco-btn primary small full" id="btn-add-page">+ Add Page</button><div class="fco-hint-sm">Drag to reorder. Drag right to nest.</div></div>` : ``}
              <div class="fco-nav-header">Structure</div>
              <ul id="fco-nav-list" class="fco-tree-list" aria-label="Site structure"></ul>
            </aside>
            <section class="fco-editor" aria-label="Editor panel"><div id="fco-editor-container"></div></section>
          </div>
        `);

        if (canStructure) $("#btn-add-page").on("click", () => this.addPageInline());
        this.renderNav({ enableDnD: canStructure });
        
        if (this.activeId && this.data.pages.find(p=>p.id===this.activeId)) {
            this.loadPageEditor(this.activeId);
        } else if (this.data.pages.length > 0) {
            this.loadPageEditor(this.data.pages[0].id);
        } else {
            this.loadPageEditor(null);
        }
    },

    // ------------------------------------------------------------
    // TAB: SETUP
    // ------------------------------------------------------------
    renderSetupTab: function($stage) {
        const p = this.data.project;
        const b = this.data.branding;
        
        $stage.html(`
            <div class="fco-dash-scroller">
                <div class="fco-dash-container">
                    <h2>Website Setup</h2>
                    <div class="fco-card">
                        <div class="fco-field-group">
                             <label class="fco-label">Company / Site Name</label>
                             <input class="fco-input bind-data" data-target="branding.company_name" value="${this.escapeAttr(b.company_name)}">
                        </div>
                         <div class="fco-field-group">
                             <label class="fco-label">Tagline</label>
                             <input class="fco-input bind-data" data-target="branding.tagline" value="${this.escapeAttr(b.tagline)}">
                        </div>
                        <div class="fco-field-group">
                             <label class="fco-label">One Liner (Footer Description)</label>
                             <textarea class="fco-input bind-data" data-target="branding.one_liner" rows="2">${this.escapeHtml(b.one_liner)}</textarea>
                        </div>
                    </div>

                    <h2>Existing Setup</h2>
                    <div class="fco-card">
                        <div class="fco-field-group">
                             <label class="fco-label">Existing Website</label>
                             <textarea class="fco-input bind-data" data-target="project.existing_website" rows="2">${this.escapeHtml(p.existing_website || "")}</textarea>
                        </div>
                        <div class="fco-field-group">
                             <label class="fco-label">Domain Name</label>
                             <input class="fco-input bind-data" data-target="project.domain" value="${this.escapeAttr(p.domain || "")}">
                        </div>
                        <div class="fco-field-group">
                             <label class="fco-label">Domain Registrar</label>
                             <input class="fco-input bind-data" data-target="project.domain_registrar" value="${this.escapeAttr(p.domain_registrar || "")}">
                        </div>
                        <div class="fco-field-group">
                             <label class="fco-label">Website Hosting</label>
                             <input class="fco-input bind-data" data-target="project.hosting" value="${this.escapeAttr(p.hosting || "")}">
                        </div>
                        <div class="fco-field-group">
                             <label class="fco-label">Business Email Setup</label>
                             <textarea class="fco-input bind-data" data-target="project.business_email_setup" rows="2">${this.escapeHtml(p.business_email_setup || "")}</textarea>
                        </div>
                        <div class="fco-field-group">
                             <label class="fco-label">Analytics & Tracking</label>
                             <textarea class="fco-input bind-data" data-target="project.analytics_setup" rows="2">${this.escapeHtml(p.analytics_setup || "")}</textarea>
                        </div>
                    </div>

                    <h2>Website Essentials</h2>
                    <div class="fco-card">
                        <div class="fco-field-group">
                             <label class="fco-label">Website Notification Email</label>
                             <input class="fco-input bind-data" data-target="project.admin_email" value="${this.escapeAttr(p.admin_email || "")}">
                        </div>
                        <div class="fco-field-group">
                             <label class="fco-label">Website Language(s)</label>
                             <textarea class="fco-input bind-data" data-target="project.languages" rows="2">${this.escapeHtml(p.languages || "")}</textarea>
                        </div>
                        <div class="fco-field-group">
                             <label class="fco-label">Business Location & Time Zone</label>
                             <textarea class="fco-input bind-data" data-target="project.timezone" rows="2">${this.escapeHtml(p.timezone || "")}</textarea>
                        </div>
                    </div>

                    <h2>WordPress Users</h2>
                    <div class="fco-card">
                        <div id="dash-user-list"></div>
                        <button class="fco-btn ghost small full" id="dash-add-user" style="margin-top:15px;">+ Add User</button>
                    </div>
                </div>
            </div>
        `);
        
        this.bindDataInputs($stage);
        this.renderUserListManager("#dash-user-list");
        $("#dash-add-user").on("click", () => {
             this.data.project.wp_users.push({username:"", first_name:"", last_name:"", role:"editor"});
             this.renderUserListManager("#dash-user-list");
             this.saveData(true);
        });
    },

    // ------------------------------------------------------------
    // TAB: BRANDING
    // ------------------------------------------------------------
    renderBrandingTab: function($stage) {
         // Replacement for External Image Meta Box: Featured Image Field
         const featImg = this.data.branding.featured_image || "";

         $stage.html(`
            <div class="fco-dash-scroller">
                <div class="fco-dash-container">
                    
                    <h2>Brand Assets (Logo, Icon)</h2>
                    <div class="fco-card">
                        <div class="fco-media-grid" id="dash-mediagrid"></div>
                        ${this.uploadZone('dash-upload-asset','Brand files','Logos, icons and artwork for this website.',true)}
                    </div>

                    <h2>Featured Image / Cover</h2>
                    <div class="fco-card">
                        <label class="fco-label">Main Project Image (replaces external featured image)</label>
                        <div style="display:flex; gap:15px; align-items:center;">
                            <input class="fco-input" id="dash-feat-img-url" value="${this.escapeAttr(featImg)}" placeholder="Image URL">
                            <button class="fco-btn ghost small" id="dash-upload-feat">Select</button>
                        </div>
                        ${featImg ? `<div style="margin-top:10px;"><img src="${this.escapeAttr(featImg)}" style="max-height:150px; border-radius:8px; border:1px solid #e2e8f0;"></div>` : ''}
                    </div>

                    <h2>Brand Colors</h2>
                    <div class="fco-card">
                        <div id="dash-palette-stage"></div>
                    </div>

                    <h2>Typography</h2>
                    <div class="fco-card">
                        <div id="dash-typo-grid" class="fco-typo-grid"></div>
                    </div>
                    
                    <h2>Inspiration</h2>
                    <div class="fco-card">
                         <label class="fco-label">Top Inspiration Links</label>
                         <div style="display:grid; gap:10px; margin-bottom:15px;" id="dash-insp-list"></div>
                         <label class="fco-label" for="fco-brand-style-notes">Style Notes</label>
                         <textarea id="fco-brand-style-notes" class="fco-input bind-data" data-target="branding.style_notes" rows="4">${this.escapeHtml(this.data.branding.style_notes)}</textarea>
                    </div>

                    <h2>Email Identity</h2>
                    <div class="fco-card">
                         <label class="fco-label">Email Signature / Footer</label>
                         <textarea class="fco-input bind-data" data-target="branding.email_signature" rows="4" placeholder="Paste your email signature HTML or text here...">${this.escapeHtml(this.data.branding.email_signature || "")}</textarea>
                    </div>
                </div>
            </div>
         `);

         this.renderPaletteManager("#dash-palette-stage");
         this.renderTypoManager("#dash-typo-grid");
         this.renderAssetManager("#dash-mediagrid");
         this.renderInspirationManager("#dash-insp-list");
         this.bindDataInputs($stage);
         
         // Featured Image Logic
         $("#dash-feat-img-url").on("input", (e) => {
             this.data.branding.featured_image = $(e.target).val();
             this.debouncedSave();
         });
         $("#dash-upload-feat").on("click", () => {
            if (!window.wp || !wp.media) return;
            const frame = wp.media({ title: "Select Featured Image", button: {text:"Select"}, multiple: false });
            frame.on("select", () => {
              const att = frame.state().get("selection").first().toJSON();
              this.data.branding.featured_image = att.url;
              this.renderBrandingTab($stage); // Re-render to show preview
              this.saveData(true);
            });
            frame.open();
         });

         $("#dash-upload-asset").on("click", (e, initialFiles = []) => {
            if (!window.wp || !wp.media) return;
            const frame = wp.media({ title: "Select Branding", button: {text:"Add"}, multiple: true, initialFiles });
            frame.on("select", () => {
              const selection = frame.state().get("selection");
              selection.map(att => { const json = att.toJSON(); if (!this.data.branding.assets.some(a => a.id === json.id)) this.data.branding.assets.push(json); });
              this.renderAssetManager("#dash-mediagrid");
              this.saveData(true);
            });
            frame.open();
         });
    },

    // ------------------------------------------------------------
    // TAB: TEAM
    // ------------------------------------------------------------
    renderTeamTab: function($stage) {
        $stage.html(`
            <div class="fco-dash-scroller">
                <div class="fco-dash-container">
                    <div style="display:flex; justify-content:space-between; align-items:center;">
                        <h2>Team Members</h2>
                        <button class="fco-btn primary small" id="dash-add-staff">+ Add Member</button>
                    </div>
                    <div class="fco-card">
                        <div id="dash-staff-list"></div>
                    </div>
                </div>
            </div>
        `);
        
        this.renderStaffManager("#dash-staff-list");
        $("#dash-add-staff").on("click", () => {
             this.data.content.staff.push({name:"", position:"", bio:"", image:""});
             this.renderStaffManager("#dash-staff-list");
             this.saveData(true);
        });
    },

    // ------------------------------------------------------------
    // TAB: BLOG
    // ------------------------------------------------------------
    renderBlogTab: function($stage) {
         const hasBlog = !!this.data.project.has_blog;
         
         $stage.html(`
            <div class="fco-dash-scroller">
                <div class="fco-dash-container">
                    <h2>Blog Configuration</h2>
                    <div class="fco-card">
                        <div class="fco-field-group">
                             <label class="fco-label">Enable Blog / News Section?</label>
                             <div class="fco-wiz-choicebar" style="justify-content:flex-start;">
                                <button type="button" class="fco-wiz-choice ${hasBlog ? 'active' : ''}" data-val="true">Yes</button>
                                <button type="button" class="fco-wiz-choice ${!hasBlog ? 'active' : ''}" data-val="false">No</button>
                             </div>
                        </div>
                    </div>
                    
                    <div id="dash-blog-cats-wrap" style="display:${hasBlog ? 'block' : 'none'};">
                        <h3>Blog Categories</h3>
                        <div class="fco-card">
                             <div class="fco-wiz-chipwrap">
                                  <input class="fco-input" id="dash-blog-cat-in" placeholder="Type category and press Enter...">
                                  <div class="fco-chiplist" id="dash-blog-cat-list"></div>
                             </div>
                        </div>
                    </div>
                </div>
            </div>
         `);
         
         $stage.find(".fco-wiz-choice").on("click", (e) => {
             const val = $(e.currentTarget).data("val");
             this.data.project.has_blog = val;
             $(e.currentTarget).siblings().removeClass("active");
             $(e.currentTarget).addClass("active");
             $("#dash-blog-cats-wrap").toggle(val);
             this.saveData(true);
         });
         
         this.renderChipsManager(this.data.branding, "blog_categories", "#dash-blog-cat-list", "#dash-blog-cat-in");
    },

    // ------------------------------------------------------------
    // TAB: SHOP
    // ------------------------------------------------------------
    renderShopTab: function($stage) {
         const hasShop = !!this.data.project.has_shop;
         
         $stage.html(`
            <div class="fco-dash-scroller">
                <div class="fco-dash-container">
                    <h2>Shop Configuration</h2>
                    <div class="fco-card">
                        <div class="fco-field-group">
                             <label class="fco-label">Enable Online Shop?</label>
                             <div class="fco-wiz-choicebar" style="justify-content:flex-start;">
                                <button type="button" class="fco-wiz-choice ${hasShop ? 'active' : ''}" data-val="true">Yes</button>
                                <button type="button" class="fco-wiz-choice ${!hasShop ? 'active' : ''}" data-val="false">No</button>
                             </div>
                        </div>
                    </div>
                    
                    <div id="dash-shop-cats-wrap" style="display:${hasShop ? 'block' : 'none'};">
                        <h3>Product Categories</h3>
                        <div class="fco-card">
                             <div class="fco-wiz-chipwrap">
                                  <input class="fco-input" id="dash-shop-cat-in" placeholder="Type category and press Enter...">
                                  <div class="fco-chiplist" id="dash-shop-cat-list"></div>
                             </div>
                        </div>
                    </div>
                </div>
            </div>
         `);
         
         $stage.find(".fco-wiz-choice").on("click", (e) => {
             const val = $(e.currentTarget).data("val");
             this.data.project.has_shop = val;
             $(e.currentTarget).siblings().removeClass("active");
             $(e.currentTarget).addClass("active");
             $("#dash-shop-cats-wrap").toggle(val);
             this.saveData(true);
         });
         
         this.renderChipsManager(this.data.branding, "shop_categories", "#dash-shop-cat-list", "#dash-shop-cat-in");
    },


    // ------------------------------------------------------------
    // DASHBOARD COMPONENT MANAGERS
    // ------------------------------------------------------------
    bindDataInputs: function($ctx) {
        $ctx.find(".bind-data").on("input", (e) => {
             const t = $(e.currentTarget).data("target");
             const parts = t.split(".");
             if(this.data[parts[0]]) this.data[parts[0]][parts[1]] = $(e.currentTarget).val();
             this.debouncedSave();
        });
    },

    renderUserListManager: function(targetId) {
        const list = this.data.project.wp_users;
        const html = list.map((u, i) => {
            const legacyAdmin = u.role === 'administrator' ? '<option value="administrator" selected disabled>Administrator · not created automatically</option>' : '';
            return `
            <div class="fco-user-row" data-user-row="${i}">
                <div class="fco-form-field"><label>Login email<input class="fco-input user-in" type="email" data-i="${i}" data-k="email" value="${this.escapeAttr(u.email || '')}" placeholder="name@example.com" autocomplete="email"></label></div>
                <div class="fco-form-field"><label>Preferred username<input class="fco-input user-in" data-i="${i}" data-k="username" value="${this.escapeAttr(u.username || '')}" placeholder="Optional · generated from email if blank"></label></div>
                <div class="fco-form-field"><label>First name<input class="fco-input user-in" data-i="${i}" data-k="first_name" value="${this.escapeAttr(u.first_name || '')}"></label></div>
                <div class="fco-form-field"><label>Last name<input class="fco-input user-in" data-i="${i}" data-k="last_name" value="${this.escapeAttr(u.last_name || '')}"></label></div>
                <div class="fco-form-field"><label>Access level<select class="fco-select user-in" data-i="${i}" data-k="role">
                    ${legacyAdmin}
                    <option value="editor" ${u.role==='editor'?'selected':''}>Editor · manage site content</option>
                    <option value="author" ${u.role==='author'?'selected':''}>Author · publish their own posts</option>
                    <option value="contributor" ${u.role==='contributor'?'selected':''}>Contributor · write without publishing</option>
                    <option value="subscriber" ${u.role==='subscriber'?'selected':''}>Subscriber · sign in only</option>
                </select></label></div>
                <button type="button" class="fco-mini danger user-del" data-i="${i}" aria-label="Remove website login">×</button>
            </div>`;
        }).join("");
        $(targetId).html((html || '<div class="fco-wiz-hint">No website logins requested.</div>') + '<p class="fco-question-help">Inkfire never creates administrator accounts through onboarding. Login accounts are only created after staff review, and account setup emails require separate approval.</p>');
        
        $(targetId).off("change input click").on("change input", ".user-in", (e) => {
             const el = $(e.currentTarget);
             list[el.data("i")][el.data("k")] = el.val();
             this.debouncedSave();
        }).on("click", ".user-del", (e) => {
             list.splice($(e.currentTarget).data("i"), 1);
             this.renderUserListManager(targetId);
             this.saveData(true);
        });
    },

    renderPaletteManager: function(targetId) {
          const brand = this.data.branding;
          const colors = brand.colors;
          const $target = $(targetId);
          const prefix = targetId.replace(/[^a-zA-Z0-9_-]/g, '') + '-colours';
          const headingTag = document.getElementById('fco-client-app')?.classList.contains('mode-wizard') ? 'h2' : 'h3';
          const updateChoice = () => {
            const delegated = brand.colours_by_inkfire === true;
            $target.find('.fco-palette-manual').prop('hidden', delegated);
            $target.find('.fco-colour-choice-status').prop('hidden', !delegated).text(delegated ? 'Inkfire will choose your brand colours. You can continue to the next section.' : '');
          };
          const render = () => {
            const strips = colors.map((c, i) => `
              <div class="fco-palette-strip" style="background:${this.escapeAttr(c.hex||'#fff')}">
                <div class="fco-strip-actions"><button aria-label="Remove colour ${i+1}" class="fco-strip-del" data-i="${i}">×</button></div>
                <div class="fco-strip-inputs">
                  <input aria-label="Colour ${i+1} name" class="fco-strip-input" data-key="name" data-i="${i}" value="${this.escapeAttr(c.name)}" placeholder="Name">
                  <input aria-label="Colour ${i+1} hex code" class="fco-strip-input" data-key="hex" data-i="${i}" value="${this.escapeAttr(c.hex)}" placeholder="#Hex">
                </div>
              </div>
            `).join("");
            $target.html(`
              <div class="fco-colour-support">
                <div class="fco-colour-guide">
                  <${headingTag}>Need some colour inspiration?</${headingTag}>
                  <p>You do not need to know colour codes. Explore colour schemes on Coolors, then paste the link to one you like below.</p>
                  <a class="fco-colour-link" href="https://coolors.co/" target="_blank" rel="noopener noreferrer">Explore colour schemes on Coolors <span aria-hidden="true">↗</span><span class="fco-colour-sr"> (opens in a new tab)</span></a>
                  <label class="fco-colour-reference-label" for="${prefix}-reference">Colour scheme link <span>(optional)</span></label>
                  <input class="fco-input fco-palette-reference" id="${prefix}-reference" type="url" maxlength="2048" autocomplete="off" spellcheck="false" placeholder="Paste your colour scheme link" value="${this.escapeAttr(brand.colour_palette_url || '')}" aria-describedby="${prefix}-reference-help">
                  <p class="fco-colour-help" id="${prefix}-reference-help">We will use this as a reference. Pasting a link does not change the colour boxes below.</p>
                </div>
                <div class="fco-colour-choice">
                  <label class="fco-colour-delegate" for="${prefix}-delegate">
                    <input type="checkbox" id="${prefix}-delegate" class="fco-colour-delegate-check" ${brand.colours_by_inkfire === true ? 'checked' : ''} aria-controls="${prefix}-manual" aria-describedby="${prefix}-delegate-help">
                    <span>Let Inkfire pick my brand colours</span>
                  </label>
                  <p class="fco-colour-help" id="${prefix}-delegate-help">Leave the colour choices to us. Any colours you have entered are kept if you untick this later.</p>
                  <p class="fco-colour-choice-status" role="status" aria-live="polite" hidden></p>
                </div>
              </div>
              <div class="fco-palette-manual" id="${prefix}-manual" ${brand.colours_by_inkfire === true ? 'hidden' : ''}>
                <p class="fco-colour-code-help">Already have brand colours? Add their codes below. A code such as <code>#07A079</code> simply identifies an exact shade.</p>
                <div class="fco-palette-stage" id="dash-palette-sortable">${strips}<button type="button" class="fco-add-strip" id="dash-add-col" aria-label="Add colour"><span class="fco-add-icon">+</span></button></div>
              </div>
            `);
            updateChoice();
            if($.fn.sortable) {
                try { $("#dash-palette-sortable").sortable("destroy"); } catch(e){}
                $("#dash-palette-sortable").sortable({
                    items: ".fco-palette-strip", axis: "x", containment: "parent", tolerance: "pointer",
                    stop: (e, ui) => {
                       const newOrder = [];
                       $("#dash-palette-sortable .fco-palette-strip").each((idx, el) => {
                           const oldIndex = $(el).find(".fco-strip-input").first().data("i");
                           if(colors[oldIndex]) newOrder.push(colors[oldIndex]);
                       });
                       colors.splice(0, colors.length, ...newOrder); this.saveData(true); render();
                    }
                });
            }
          };
          render();
          
          $target.off("input click change").on("change", ".fco-colour-delegate-check", (e) => {
            brand.colours_by_inkfire = e.currentTarget.checked;
            updateChoice();
            this.debouncedSave();
          }).on("input", ".fco-palette-reference", (e) => {
            brand.colour_palette_url = e.currentTarget.value;
            this.debouncedSave();
          }).on("input", ".fco-strip-input", (e) => {
            if (brand.colours_by_inkfire === true) return;
            const el = $(e.currentTarget); const idx = el.data("i"); const key = el.data("key");
            if(colors[idx]) { 
                colors[idx][key] = el.val(); 
                if (key === "hex") el.closest(".fco-palette-strip").css("background", el.val()); 
                this.debouncedSave();
            }
          }).on("click", ".fco-strip-del", (e) => {
              if (brand.colours_by_inkfire === true) return;
              colors.splice($(e.currentTarget).data("i"), 1); render(); this.saveData(true);
          }).on("click", "#dash-add-col", () => {
              if (brand.colours_by_inkfire === true) return;
              colors.push({ name: "New", hex: "#cccccc", pantone: "" }); render(); this.saveData(true);
          });
    },

    fontRoleLabel: function(font) {
        if (font.usage === 'body') return 'Body text';
        const label = String(font.label || 'Font');
        return ({Primary:'Headings',Secondary:'Body text',Tertiary:'Accent (optional)',Other:'Other (optional)'})[label] || label;
    },

    renderTypoManager: function(targetId) {
        const brand = this.data.branding;
        const fonts = brand.fonts;
        const $target = $(targetId);
        const prefix = targetId.replace(/[^a-zA-Z0-9_-]/g, '') + '-fonts';
        const headingTag = document.getElementById('fco-client-app')?.classList.contains('mode-wizard') ? 'h2' : 'h3';
        const recommended = 'Atkinson Hyperlegible Next';
        const specimen = 'https://fonts.google.com/specimen/Atkinson+Hyperlegible+Next';
        const bodyIndex = () => {
            let i = fonts.findIndex(f => f.usage === 'body' || /\bbody\b/i.test(f.label || ''));
            if (i < 0) i = fonts.findIndex(f => f.label === 'Secondary');
            if (i < 0) i = fonts.findIndex(f => !f.name && !f.url);
            if (i < 0) i = fonts.length < 4 ? fonts.length : Math.min(1, fonts.length - 1);
            return i;
        };
        const updateRecommendation = () => {
            const font = fonts[bodyIndex()];
            const selected = !!font && font.name === recommended && !font.url;
            $target.find('.fco-use-body-font').prop('disabled', selected).text(selected ? 'Selected for body text' : 'Use for body text');
            $target.find('.fco-font-choice-status').text(selected ? recommended + ' is selected for body text.' : '');
        };
        const render = () => {
            const rows = fonts.map((f, i) => `
              <div class="fco-font-row">
                <label class="fco-font-role" for="${prefix}-${i}">${this.escapeHtml(this.fontRoleLabel(f))}</label>
                <input id="${prefix}-${i}" class="fco-input fco-font-name" data-i="${i}" value="${this.escapeAttr(f.name)}" placeholder="Type a font name" maxlength="200" autocomplete="off" spellcheck="false" aria-describedby="${prefix}-help">
                <button type="button" class="fco-btn ghost small typo-up" data-i="${i}" aria-label="Upload a font for ${this.escapeAttr(this.fontRoleLabel(f))}">Upload file</button>
              </div>`).join('');
            $target.html(`
              <div class="fco-font-support">
                <section class="fco-font-guide" aria-labelledby="${prefix}-browse-title">
                  <${headingTag} id="${prefix}-browse-title">No font file? Choose one online.</${headingTag}>
                  <p>Browse Google Fonts, preview a style you like, then type its name below. No upload is needed.</p>
                  <a class="fco-font-link" href="https://fonts.google.com/" target="_blank" rel="noopener noreferrer">Browse Google Fonts <span aria-hidden="true">↗</span><span class="fco-font-sr"> (opens in a new tab)</span></a>
                  <p class="fco-font-help">One font for headings and one for body text is usually plenty. Extra fonts are optional.</p>
                </section>
                <section class="fco-font-recommendation" aria-labelledby="${prefix}-recommend-title">
                  <p class="fco-font-eyebrow">Our suggestion for readable body text</p>
                  <${headingTag} id="${prefix}-recommend-title">Atkinson Hyperlegible Next</${headingTag}>
                  <p>Designed with low-vision readers in mind, with distinctive letters and numbers. We recommend it as a starting point for paragraphs and longer text.</p>
                  <div class="fco-font-actions"><a class="fco-font-link" href="https://www.brailleinstitute.org/freefont/" target="_blank" rel="noopener noreferrer">Preview at Braille Institute <span aria-hidden="true">↗</span><span class="fco-font-sr"> (opens in a new tab)</span></a><button type="button" class="fco-use-body-font">Use for body text</button></div>
                  <p class="fco-font-help">Readable text also needs suitable size, spacing and contrast. We will review these during the design.</p>
                </section>
              </div>
              <p class="fco-font-entry-help" id="${prefix}-help">Enter the font names you like, or upload your own font files. This records your choices for the build; it does not install fonts on your website.</p>
              <div class="fco-font-rows">${rows}</div>
              <p class="fco-font-choice-status" role="status" aria-live="polite"></p>`);
            updateRecommendation();
        };
        render();
        // The wizard and dashboard share these bindings and the original fonts array.
        $target.off('.fcoFonts').on('input.fcoFonts', '.fco-font-name', e => {
            const font = fonts[Number(e.currentTarget.dataset.i)];
            if (!font) return;
            if (font.name !== e.currentTarget.value) {
                font.name = e.currentTarget.value;
                // A different name must not keep pointing to a previously selected file.
                // This only removes the reference; the file remains in the project vault.
                font.url = '';
                font.source = 'named';
                font.source_url = '';
            }
            updateRecommendation();
            this.debouncedSave();
        }).on('click.fcoFonts', '.fco-use-body-font', () => {
            const i = bodyIndex(), previous = fonts[i];
            if (previous && (previous.name || previous.url) && (previous.name !== recommended || previous.url)) {
                if (!window.confirm('Replace the ' + this.fontRoleLabel(previous) + ' selection (' + (previous.name || 'uploaded font') + ') with ' + recommended + '? Other font choices and uploaded files will be kept.')) return;
            }
            fonts[i] = Object.assign({}, previous || {}, {label:'Body text',usage:'body',name:recommended,url:'',source:'google',source_url:specimen});
            // Keep keyboard focus on the action instead of rebuilding the whole panel.
            const $row = $target.find('.fco-font-name').filter((_, el) => Number(el.dataset.i) === i);
            if ($row.length) {
                $row.val(recommended);
                $row.closest('.fco-font-row').find('label').text('Body text');
                $row.closest('.fco-font-row').find('.typo-up').attr('aria-label','Upload a font for Body text');
                updateRecommendation();
            } else {
                render();
                $target.find('.fco-font-name').last().trigger('focus');
            }
            this.debouncedSave();
        }).on('click.fcoFonts', '.typo-up', e => {
            const i = Number(e.currentTarget.dataset.i), previous = fonts[i];
            if (!window.wp || !wp.media || !previous) return;
            const frame = wp.media({title:'Choose a font file',button:{text:'Select'},multiple:false});
            frame.on('select', () => {
                if (this.data.branding !== brand || !document.contains($target[0]) || fonts[i] !== previous) return;
                const first = frame.state().get('selection').first();
                if (!first) return;
                const att = first.toJSON();
                if (!/\.(woff2?|ttf|otf)$/i.test(att.filename || '')) {
                    $target.find('.fco-font-choice-status').text('Choose a WOFF, WOFF2, TTF or OTF font file. Use the name fields for Google Fonts.');
                    return;
                }
                fonts[i].name = att.filename;
                fonts[i].url = att.url;
                fonts[i].source = 'upload';
                fonts[i].source_url = '';
                render();
                this.saveData(true);
            });
            frame.open();
        });
    },

    renderAssetManager: function(targetId) {
        const assets = this.data.branding.assets;
        const html = assets.map((a, i) => `
              <div class="fco-media-item"><img src="${this.escapeAttr(a.url)}"><button type="button" class="fco-media-x" data-i="${i}">×</button></div>
        `).join("");
        $(targetId).html(html);
        
        $(targetId).off("click").on("click", ".fco-media-x", (e) => {
             assets.splice($(e.currentTarget).data("i"), 1);
             this.renderAssetManager(targetId);
             this.saveData(true);
        });
    },
    
    renderInspirationManager: function(targetId) {
        const links = this.data.branding.inspiration_links;
        const html = links.map((lnk, i) => `<input aria-label="Inspiration website ${i+1}" class="fco-input insp-lnk" data-i="${i}" value="${this.escapeAttr(lnk)}" placeholder="https://" style="margin-bottom:8px;">`).join("");
        $(targetId).html(html);
        $(targetId).on("input", ".insp-lnk", (e) => {
            links[$(e.target).data("i")] = $(e.target).val();
            this.debouncedSave();
        });
    },

    renderStaffManager: function(targetId) {
        const list = this.data.content.staff;
        const render = () => {
            const html = list.map((m, i) => `
                <div class="fco-typo-row" style="margin-bottom:10px; grid-template-columns: 60px 1fr auto;">
                    <button type="button" class="staff-thumb" data-i="${i}" aria-label="Choose photo for team member ${i+1}">
                        ${m.image ? `<img src="${this.escapeAttr(m.image)}" alt="" style="width:100%; height:100%; object-fit:cover;">` : ''}
                        <span class="staff-overlay" aria-hidden="true"><span class="dashicons dashicons-camera"></span></span>
                    </button>
                    <div style="display:grid; gap:5px;">
                        <input aria-label="Team member ${i+1} name" class="fco-input staff-in" data-i="${i}" data-k="name" value="${this.escapeAttr(m.name)}" placeholder="Name">
                        <input aria-label="Team member ${i+1} role" class="fco-input staff-in" data-i="${i}" data-k="position" value="${this.escapeAttr(m.position)}" placeholder="Position">
                        <textarea aria-label="Team member ${i+1} biography" class="fco-input staff-in" data-i="${i}" data-k="bio" rows="2" placeholder="Short Bio">${this.escapeHtml(m.bio)}</textarea>
                    </div>
                    <div style="display:flex; flex-direction:column; gap:5px;">
                        <button class="fco-mini danger staff-del" data-i="${i}">×</button>
                    </div>
                </div>
            `).join("");
            $(targetId).html(html);
        };
        render();

        $(targetId).off("click input").on("click", ".staff-del", (e) => { list.splice($(e.currentTarget).data("i"), 1); render(); this.saveData(true); });
        $(targetId).on("input", ".staff-in", (e) => {
            const el = $(e.currentTarget);
            list[el.data("i")][el.data("k")] = el.val();
            this.debouncedSave();
        });
        
        // Task 9: Click anywhere on thumb/overlay to upload
        $(targetId).on("click", ".staff-thumb", (e) => {
            const i = $(e.currentTarget).data("i");
            if(!wp.media) return;
            const frame = wp.media({ title: "Staff Photo", button: {text:"Select"}, multiple: false });
            frame.on("select", () => {
                const att = frame.state().get("selection").first().toJSON();
                list[i].image = att.url;
                render();
                $(targetId).find(`.staff-thumb[data-i="${i}"]`).trigger('focus');
                this.saveData(true);
            });
            frame.open();
        });
    },

    renderChipsManager: function(dataObj, key, listId, inputId) {
        if (!Array.isArray(dataObj[key])) dataObj[key] = [];
        const arr = dataObj[key];
        
        const render = () => {
            const html = arr.map((x,i) => `<span class="fco-chip">${this.escapeHtml(x)}<button class="fco-chip-x" data-i="${i}">×</button></span>`).join("");
            $(listId).html(html || '<div class="fco-wiz-hint">None added.</div>');
        };
        render();
        
        $(inputId).off("keydown").on("keydown", (e) => {
            if(e.key === "Enter"){
                e.preventDefault();
                const v = $(e.target).val().trim();
                if(v){ arr.push(v); $(e.target).val(""); render(); this.saveData(true); }
            }
        });
        this.trackPendingInput?.(inputId, key, () => $(inputId).trigger($.Event("keydown", {key:"Enter"})));
        $(listId).off("click").on("click", ".fco-chip-x", (e) => {
            arr.splice($(e.currentTarget).data("i"), 1); render(); this.saveData(true);
        });
    },

    // ------------------------------------------------------------
    // NAV & PAGE LOGIC (FROM ORIGINAL)
    // ------------------------------------------------------------
    renderNav: function ({ enableDnD }) {
      const $list = $("#fco-nav-list");
      $list.empty();
      this.data.pages.sort((a, b) => (a.sort || 0) - (b.sort || 0));
      const pages = this.data.pages.map(p => {
        const level = this.getLevel(p.id);
        const st = (this.data.drafts[p.id] || {}).status || "empty";
        return `
          <li class="fco-node" data-id="${this.escapeAttr(p.id)}" data-status="${this.escapeAttr(st)}" data-level="${level}">
            <div class="fco-node-inner" style="margin-left:${level * 34}px">
              <span class="fco-drag" aria-hidden="true">⋮⋮</span>
              <span class="fco-node-title" contenteditable="true" role="textbox" aria-label="Page title">${this.escapeHtml(p.title)}</span>
              <button type="button" class="fco-node-chip" aria-label="Edit content for ${this.escapeAttr(p.title)}">${this.statusLabel(st)}</button>
              <div class="fco-node-actions">
                <button type="button" class="fco-mini" data-act="up" aria-label="Move ${this.escapeAttr(p.title)} up">↑</button>
                <button type="button" class="fco-mini" data-act="down" aria-label="Move ${this.escapeAttr(p.title)} down">↓</button>
                <button type="button" class="fco-mini" data-act="outdent">←</button>
                <button type="button" class="fco-mini" data-act="indent">→</button>
                <button type="button" class="fco-mini danger" data-act="delete">×</button>
              </div>
            </div>
          </li>
        `;
      }).join("");
      $list.html(pages || `<li class="fco-empty-msg">No pages yet. Add one to begin.</li>`);
      $list.find(".fco-node").on("click", (e) => {
        if ($(e.target).is('[contenteditable="true"]')) return;
        if ($(e.target).closest(".fco-node-actions").length) return;
        this.loadPageEditor($(e.currentTarget).data("id"));
      });
      $list.find(".fco-node-title").on("blur", (e) => {
        const id = $(e.currentTarget).closest(".fco-node").data("id");
        const p = this.data.pages.find(x => x.id === id);
        if (p) { p.title = $(e.currentTarget).text().trim() || "Untitled"; this.saveData(true); if (this.activeId === id) $("#fco-editor-container h1").first().text(p.title); }
      });
      $list.find(".fco-mini").on("click", (e) => {
        e.preventDefault(); e.stopPropagation();
        const act = $(e.currentTarget).data("act");
        const $btn = $(e.currentTarget).closest(".fco-node");
        const id = $btn.data("id");
        if (act === 'up' || act === 'down') {
          const ordered = this.data.pages.slice().sort((a,b)=>(a.sort||0)-(b.sort||0));
          const moved = this.reorderBranch(ordered,id,act==='up'?-1:1,p=>this.getLevel(p.id));
          moved.forEach((page,i)=>{page.sort=i;}); this.data.pages=moved;
          this.saveData(true); this.renderNav({enableDnD:true});
          $list.find(`.fco-node[data-id="${this.cssEscape(id)}"] [data-act="${act}"]`).trigger('focus');
          return;
        }
        if (act === "delete") return this.deletePage(id);
        if (act === "indent") return this.indentPage(id);
        if (act === "outdent") return this.outdentPage(id);
      });
      if (enableDnD && $.fn.sortable) {
        try { $list.sortable("destroy"); } catch(e) {}
        $list.sortable({
          handle: ".fco-drag", placeholder: "fco-sort-placeholder", tolerance: "pointer",
          stop: (event, ui) => {
            const listLeft = $list.offset().left; const itemLeft = ui.offset.left; const dx = itemLeft - listLeft;
            let desired = Math.floor((dx - 40) / 40); desired = Math.max(0, Math.min(3, desired));
            const orderIds = []; $list.children(".fco-node").each((_, el) => orderIds.push($(el).data("id")));
            const newOrder = []; orderIds.forEach(id => { const p = this.data.pages.find(x => x.id === id); if (p) newOrder.push(p); });
            const levels = new Map(); newOrder.forEach(p => levels.set(p.id, this.getLevel(p.id)));
            const draggedId = ui.item.data("id"); const pos = newOrder.findIndex(p => p.id === draggedId);
            const prev = pos > 0 ? newOrder[pos - 1] : null; const prevLevel = prev ? (levels.get(prev.id) || 0) : 0;
            const maxAllowed = prev ? prevLevel + 1 : 0;
            levels.set(draggedId, Math.min(desired, maxAllowed));
            for (let i = 0; i < newOrder.length; i++) {
              const prevP = i > 0 ? newOrder[i - 1] : null;
              const prevL = prevP ? (levels.get(prevP.id) || 0) : 0;
              const maxL = prevP ? prevL + 1 : 0;
              const currId = newOrder[i].id;
              const currL = levels.get(currId) || 0;
              levels.set(currId, Math.min(currL, maxL));
            }
            const stack = [];
            newOrder.forEach((p, i) => {
              const lvl = levels.get(p.id) || 0;
              const parent = lvl === 0 ? null : (stack[lvl - 1] || null);
              p.parent = parent; p.sort = Date.now() + i;
              stack[lvl] = p.id; stack.length = lvl + 1;
            });
            this.saveData(true); this.renderNav({ enableDnD: true });
          }
        });
      }
      if (this.activeId) $list.find(`.fco-node[data-id="${this.cssEscape(this.activeId)}"]`).addClass("active");
    },
    
    // ... Page Tree Helpers ...
    getLevel: function (id) {
      let lvl = 0; let p = this.data.pages.find(x => x.id === id); const guard = new Set();
      while (p && p.parent && !guard.has(p.parent)) { guard.add(p.parent); lvl++; p = this.data.pages.find(x => x.id === p.parent); if (lvl > 6) break; }
      return Math.min(lvl, 3);
    },
    indentPage: function (id) {
      const list = this.data.pages.slice().sort((a, b) => (a.sort || 0) - (b.sort || 0));
      const idx = list.findIndex(p => p.id === id);
      if (idx <= 0) return;
      const prev = list[idx - 1]; const currLevel = this.getLevel(id);
      if (currLevel >= 3) return;
      const p = this.data.pages.find(x => x.id === id);
      if (p) { p.parent = prev.id; p.sort = Date.now(); this.saveData(true); this.renderNav({ enableDnD: true }); }
    },
    outdentPage: function (id) {
      const p = this.data.pages.find(x => x.id === id); if (!p || !p.parent) return;
      const parent = this.data.pages.find(x => x.id === p.parent);
      p.parent = parent ? parent.parent : null; p.sort = Date.now(); this.saveData(true); this.renderNav({ enableDnD: true });
    },
    deletePage: function (id) {
      if (!confirm("Delete this page?")) return;
      const target = this.data.pages.find(x => x.id === id);
      const parentId = target ? target.parent : null;
      this.data.pages.forEach(p => { if (p.parent === id) p.parent = parentId || null; });
      this.data.pages = this.data.pages.filter(p => p.id !== id);
      delete this.data.drafts[id]; delete this.data.drafts[`${id}::main`];
      if (this.activeId === id) this.activeId = null;
      this.saveData(); this.renderNav({ enableDnD: true }); this.loadPageEditor(this.data.pages.length ? this.data.pages[0].id : null);
    },
    addPageInline: function () {
      const id = this.uid("p"); this.data.pages.push({ id, title: "New Page", parent: null, sort: Date.now() });
      if (!this.data.drafts[id]) this.data.drafts[id] = { status: "empty", goal: "", notes: "" };
      this.saveData(true); this.renderNav({ enableDnD: true });
      setTimeout(() => { const $node = $(`#fco-nav-list .fco-node[data-id="${this.cssEscape(id)}"] .fco-node-title`); if ($node.length) { $node.focus(); document.execCommand("selectAll", false, null); } }, 30);
    },
    statusLabel: function (s) { return s === "draft" ? "Draft" : (s === "review" ? "Review" : (s === "approved" ? "Done" : "Empty")); },

    loadPageEditor: function (id) {
      this.activeId = id;
      this.destroyWpEditor();
      this.renderNav({ enableDnD: (FCO_Config.isAdmin || !!FCO_Config.clientCanEditStructure) });
      const $container = $("#fco-editor-container");
      $container.empty();
      if (!id) { $container.html(`<div class="fco-empty"><h1 class="fco-empty-title">Select a page</h1></div>`); $("#fco-aside-content").html(""); return; }
      const p = this.data.pages.find(x => x.id === id); if (!p) return;
      const contentKey = `${id}::main`;
      if (!this.data.drafts[contentKey]) this.data.drafts[contentKey] = { content: "" };
      if (!this.data.drafts[id]) this.data.drafts[id] = { status: "empty", goal: "", notes: "" };
      const draft = this.data.drafts[contentKey];
      const editorId = `fco_wp_editor_${id.replace(/[^a-zA-Z0-9_]/g, "_")}`;
      this.wpEditorId = editorId;
      
      const st = this.data.drafts[id].status || "empty";

      $container.html(`
        <div class="fco-editor-header" style="display:flex; justify-content:space-between; align-items:center;">
            <h1>${this.escapeHtml(p.title)}</h1>
            <select class="fco-select" id="header-status" style="width:auto;">
                <option value="empty" ${st === "empty" ? "selected" : ""}>Not started</option>
                <option value="draft" ${st === "draft" ? "selected" : ""}>Drafting</option>
                <option value="review" ${st === "review" ? "selected" : ""}>Review</option>
                <option value="approved" ${st === "approved" ? "selected" : ""}>Approved</option>
            </select>
        </div>
        <div class="fco-field-grid">
          <div class="fco-field-group"><label class="fco-label">Page purpose</label><input type="text" class="fco-input" id="page-goal" value="${this.escapeAttr(this.data.drafts[id].goal || "")}"></div>
        </div>
        <div class="fco-split-stage">
            <div class="fco-wiz-rich">
                <div class="fco-wiz-hint" style="text-align:left; margin-bottom:10px;">Page Content</div>
                <textarea id="${this.escapeAttr(editorId)}">${this.escapeHtml(draft.content || "")}</textarea>
            </div>
            <div class="fco-wiz-rich" style="padding:15px;">
                <div class="fco-label" style="text-align:left;">Page Images / References</div>
                <div class="fco-media-grid" id="editor-page-imgs"></div>
                ${this.uploadZone('editor-add-img','Images for this page','Photos, illustrations and references.',true)}
            </div>
        </div>
        
        <!-- NEW: Comments Section (Below Editor) -->
        <div class="fco-comments-section">
            <button type="button" class="fco-comments-toggle" id="comments-toggle" aria-expanded="false" aria-controls="comments-body">
                <span>View Discussion</span>
                <span id="comment-count" style="background:#e2e8f0; padding:2px 8px; border-radius:99px; font-size:0.8rem;">
                    ${(this.data.comments[id] || []).length}
                </span>
            </button>
            <div class="fco-comments-body" id="comments-body">
                <div id="fco-comments-list" style="max-height:300px; overflow-y:auto; margin-bottom:15px;"></div>
                <textarea class="fco-input" id="new-comment-text" rows="2" placeholder="Write a comment..." style="margin-bottom:10px;"></textarea>
                <button class="fco-btn primary small" id="add-comment-btn">Post Comment</button>
            </div>
        </div>
      `);
      
      $("#header-status").on("change", (e) => { 
          this.data.drafts[id].status = $(e.target).val(); 
          this.saveData(); 
          this.renderNav({ enableDnD: true }); 
      });
      
      $("#page-goal").on("input", (e) => { this.data.drafts[id].goal = $(e.target).val(); if (this.data.drafts[id].status === "empty") this.data.drafts[id].status = "draft"; this.debouncedSave(); });
      this.initWpEditor(editorId, { onChange: (newHtml) => { this.data.drafts[contentKey].content = newHtml; if (this.data.drafts[id].status === "empty") this.data.drafts[id].status = "draft"; this.debouncedSave(); } });
      if (!Array.isArray(this.data.drafts[id].images)) this.data.drafts[id].images = [];
      const renderEditorImages = () => {
         const imgs = this.data.drafts[id].images;
         $("#editor-page-imgs").html(imgs.map((img, i) => `<div class="fco-media-item"><img src="${this.escapeAttr(img.url)}"><button class="fco-media-x" data-i="${i}">×</button></div>`).join(""));
      };
      renderEditorImages();
      $("#editor-add-img").on("click", (e, initialFiles = []) => {
         const frame = wp.media({ multiple: true, initialFiles });
         frame.on("select", () => { const selection = frame.state().get("selection"); selection.map(att => this.data.drafts[id].images.push({ id: att.id, url: att.attributes.url })); renderEditorImages(); this.saveData(true); });
         frame.open();
      });
      $container.off("click.fcoPageImages", "#editor-page-imgs .fco-media-x").on("click.fcoPageImages", "#editor-page-imgs .fco-media-x", (e) => { this.data.drafts[id].images.splice($(e.currentTarget).data("i"), 1); renderEditorImages(); this.saveData(true); });
      
      // Comments Logic
      this.initComments(id);
    },

    initComments: function(id) {
        if (!Array.isArray(this.data.comments[id])) this.data.comments[id] = [];
        const comments = this.data.comments[id];
        
        const renderList = () => {
            const listHtml = comments.map((c, i) => `
                <div class="fco-comment-item">
                    <div style="font-size:0.75rem; color:#64748b; display:flex; justify-content:space-between; margin-bottom:4px;">
                        <strong>${this.escapeHtml(c.author)}</strong>
                        <span>${this.escapeHtml(c.date)}</span>
                    </div>
                    <div style="font-size:0.95rem; color:#334155; white-space:pre-wrap; line-height:1.4;">${this.escapeHtml(c.text)}</div>
                </div>
            `).join("");
            $("#fco-comments-list").html(listHtml || '<div class="fco-empty-msg">No comments yet. be the first!</div>');
            $("#comment-count").text(comments.length);
        };
        
        renderList();
        
        $("#comments-toggle").on("click", () => {
            $("#comments-body").toggleClass("open");
        });
        
        $("#add-comment-btn").on("click", () => {
            const txt = $("#new-comment-text").val().trim();
            if(!txt) return;
            
            const now = new Date();
            const dateStr = now.toLocaleDateString() + ' ' + now.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
            
            comments.unshift({
                author: FCO_Config.user.name || "User",
                date: dateStr,
                text: txt
            });
            
            $("#new-comment-text").val("");
            renderList();
            this.saveData(true);
        });
    },

    // Shared visual upload area. Selection still uses the project-scoped file picker.
    uploadZone: function (buttonId, heading, detail, compact = false) {
      return `<div class="fco-upload-zone${compact ? ' fco-upload-compact' : ''}" data-upload-button="${this.escapeAttr(buttonId)}"><svg class="fco-upload-symbol" viewBox="0 0 24 24" width="36" height="36" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M12 16V4m-5 5 5-5 5 5M4 16v4h16v-4"/></svg><strong>${this.escapeHtml(heading)}</strong><p>${this.escapeHtml(detail)}</p><button type="button" class="fco-btn ghost" id="${this.escapeAttr(buttonId)}">Choose files</button><span class="fco-upload-caption">Drag files here, or choose from this project’s files.</span></div>`;
    },

    // ------------------------------------------------------------
    // WIZARD RENDER (RETAINED FROM V16)
    // ------------------------------------------------------------
    renderWizard: function ($el) {
       // ... Wizard logic remains identical to v16, ensuring smooth onboarding ...
       // For brevity in this specific file replacement, I'm ensuring it calls the existing structure.
       // The V16 Wizard logic is large. I will include the critical parts to ensure it works.
       // NOTE: Since I am replacing the file entirely, I must include the Wizard code.
       
      const name = window.FCO_HubBridge?.context?.contact_name || FCO_Config.user?.name || "there";
      const isAdmin = !!FCO_Config.isAdmin;
      // HARDCODED LOGO PATH (Wizard)
      const logoUrl = FCO_Config.pluginUrl + "assets/v3/inkfire-mark.png";
      
      // UX OPTIMIZATION VARIABLES
      let navLocked = false;
      let typingToken = 0;
      
      // TYPEWRITER CONSTANTS
      const TYPE_MIN_MS = 12;      // fastest per char
      const TYPE_MAX_MS = 28;      // slowest per char
      const TYPE_BASE_MS = 18;     // normal
      const TYPE_PUNCT_BONUS = 120; // pause on punctuation
      const TYPE_NEWLINE_BONUS = 160;
      const sleep = (ms) => new Promise(r => setTimeout(r, ms));

      let steps = [
        { id: "site_name", type: "grouped_fields", title: "Website basics", text: "Let’s start with your website’s key details.", fields: [
          {target:'branding.company_name',label:'Website / organisation name',kind:'text',placeholder:'e.g. Your organisation',help:'The name visitors should see on your website.'},
          {target:'branding.tagline',label:'Tagline (optional)',kind:'text',placeholder:'A short line that sums up your brand',help:'Leave this blank if you do not have one yet.'},
          {target:'project.admin_email',label:'Website notification email',kind:'email',wide:true,placeholder:'name@example.com',help:'For website administration notifications. Public contact details come later.'}
        ] },
        { id: "admin_setup", type: "grouped_fields", title: "Language & location", text: "Which languages and time zone should we plan for?", fields: [
          {target:'project.languages',label:'Website language(s)',kind:'textarea',help:'The main language and any translations you need.'},
          {target:'project.timezone',label:'Location and time zone',kind:'textarea',help:'Your town or city and country is enough if you do not know the time zone.'}
        ] },
        { id: "contact_info", type: "contact_info", title: "Contact details", text: "Where can customers find you? Add multiple emails/phones if needed." },
        { id: "socials", type: "socials_manager", title: "Social media", text: "Add links to your social profiles." },
        { id: "logos", type: "media_multiple", title: "Brand assets", text: "Upload your logo, icon, and other brand files.", target: "branding.assets" },
        { id: "brand_colours", type: "brand_colours_pantone", title: "Brand colours", text: "Which colours would you like for your brand?", target: "branding.colors" },
        { id: "typography", type: "typography_selector", title: "Typography", text: "Choose the fonts for your website.", target: "branding.fonts" },
        { id: "inspiration", type: "inspiration", title: "Design Inspiration", text: "What inspires you? Share websites you love and any brand guidelines." },
        { id: "brand_summary", type: "brand_summary", title: "Brand Identity", text: "Does this feel like your brand? Review your choices before we continue." },
        { id: "blog_toggle", type: "choice", title: "Blog / News", text: "Do you want a blog or news section?", target: "project.has_blog", options: [ { label: "Yes, I need a blog", value: true }, { label: "No, not right now", value: false } ]},
        { id: "blog_cats", type: "chips", title: "Blog Categories", text: "What topics will you cover?", target: "branding.blog_categories", when: () => !!this.data.project.has_blog, placeholder: "Type a category and press Enter..." },
        { id: "shop_toggle", type: "choice", title: "Online shop", text: "Do you plan to sell products online?", target: "project.has_shop", options: [ { label: "Yes, discuss an online shop", value: true }, { label: "No, just a brochure site", value: false } ]},
        { id: "shop_cats", type: "chips", title: "Product categories", text: "What types of products do you sell?", target: "branding.shop_categories", when: () => !!this.data.project.has_shop, placeholder: "e.g. T-Shirts, Mugs..." },
        { id: "staff_roster", type: "staff_manager", title: "Team", text: "Add staff members for your 'Team' page." },
        { id: "wp_users", type: "user_manager", title: "Website logins", text: "Who needs a login to the new website? Add a genuine email address and choose the least access they need. Administrator accounts are never created automatically." },
        { id: "pages", type: "page_builder", title: "Sitemap", text: "Let's plan your pages. Drag to reorder or nest.", target: "pages.structure" },
        { id: "build_page_steps", type: "build_page_steps", title: "Content", text: "Let's create your webpage content. (Tip: you can save and come back at anytime)", target: null },
        { id: "outro", type: "outro", title: "Review your answers", text: "Ready for us to take a look?" }
      ];

      const hasFeature = feature => (this.data.project.features || []).includes(feature);
      const insertBefore = (id, additions) => steps.splice(steps.findIndex(step => step.id === id), 0, ...additions);
      insertBefore('admin_setup', [
        {id:'goals',type:'grouped_fields',title:'Purpose & audience',text:'Who do you help, and what should your website achieve?',fields:[
          {target:'branding.one_liner',label:'What you do',kind:'textarea',wide:true,help:'A sentence or two about your organisation and who you help.'},
          {target:'project.goals',label:'Audience and website goals',kind:'textarea',wide:true,help:'Who will visit, what should they be able to do, and what would success look like?'}
        ]},
        {id:'features',type:'features',title:'Website features',text:'What does your website need to do?',help:'Choose everything that applies. It is fine to be unsure — we will help you decide.'},
        {id:'site_setup',type:'setup_fields',title:'Existing setup',text:'What do you already have in place?',fields:[['existing_website','Existing website address (optional)','Paste only the full website address, e.g. https://example.com. Leave this blank if you do not have a website.'],['domain','Website address you own or would like','Enter the domain you want to use and say whether you already own it. You can also say you need help choosing one.'],['domain_registrar','Domain registrar','Who manages the domain? e.g. GoDaddy, IONOS, Namecheap or Cloudflare. No passwords.'],['hosting','Website hosting','If hosting already exists, tell us the provider and package if you know it. If not, say none.'],['business_email_setup','Business email','If email is already set up on your domain, tell us the provider, e.g. Microsoft 365 or Google Workspace. No passwords.'],['analytics_setup','Analytics & tracking','Anything already in use, e.g. Google Analytics, Search Console or Meta Pixel. If none, say none.']]}
      ]);
      insertBefore('staff_roster', [
        {id:'commerce_details',type:'setup_fields',title:'Shop requirements',text:'How should your online shop work?',when:()=>!!this.data.project.has_shop,fields:[['products','Products and catalogue','Physical, digital, variable products; approximate quantity.'],['payments','Currency and payment preferences','Provider names only, never bank or card details.'],['shipping','Delivery, collection and selling regions','Countries, delivery rules or collection arrangements.'],['tax_invoices','Tax and invoice requirements','Tell us what your accountant has specified, or say unsure.']]},
        {id:'booking_details',type:'setup_fields',title:'Bookings & appointments',text:'What can customers book, and how should availability work?',when:()=>hasFeature('bookings'),fields:[['bookables','Services, people or resources','e.g. consultations, rooms, equipment or events'],['availability','Duration and availability','Fixed or flexible duration, opening times, capacity and buffers.'],['booking_payments','Payment and cancellation preferences','Deposits, full payment, approvals, reminders and cancellations.']]},
        {id:'member_details',type:'setup_fields',title:'Accounts & memberships',text:'Who needs a customer account, and what can they access?',when:()=>hasFeature('memberships'),fields:[['member_access','Account types and access','Public, members-only, organisation or staff areas.'],['member_billing','Membership and subscription rules','Free or paid, renewals, trials and cancellation preferences.']]},
        {id:'specialist_features',type:'textarea',title:'Feature details',text:'Let’s shape the features you selected.',target:'project.specialist_features',placeholder:'',when:()=>['courses','directory','events','forms','multilingual','custom','gallery','downloads','search','donations'].some(hasFeature),help:'Describe the selected features: course access and progress, listing approvals, event ticketing, enquiry routing, translations or a custom process. Tell us who does what and any rules or limits.'},
        {id:'integrations',type:'textarea',title:'Website connections',text:'Which services should your website connect to?',target:'project.integrations',placeholder:'',help:'CRM, email marketing, forms, accounting, automation, search, directories, learning tools or custom workflows. Name systems and explain what should happen; no API keys.'},
        {id:'migration',type:'textarea',when:()=>!!String(this.data.project.existing_website||'').trim(),title:'Existing content & migration',text:'What needs moving from your existing website?',target:'project.migration',placeholder:'',help:'Pages, media, products, orders, users, bookings or other records. Tell us which URLs, search rankings and email services must be preserved. Do not upload personal customer records here.'},
        {id:'accessibility_privacy',type:'textarea',title:'Accessibility & privacy',text:'What access needs, privacy requirements or policies should we plan for?',target:'project.accessibility_privacy',placeholder:'',help:'Audience access needs, consent, data collection, retention, policy owners and any agreed accessibility targets. We will review the requirements with you.'},
        {id:'launch_plan',type:'setup_fields',title:'Launch & handover',text:'Let’s plan your launch and handover.',fields:[['launch_date','Target date and key milestones','Tell us about fixed events or deadlines.'],['approvals','Who approves content and launch?','Names or roles and how decisions are made.'],['aftercare','Ongoing maintenance and handover','Updates, backups, monitoring, training, analytics and reporting.']]}
      ]);
      const extraQuestions = Array.isArray(this.data.project.extra_questions) ? this.data.project.extra_questions : [];
      this.data.project.extra_question_answers = (this.data.project.extra_question_answers && typeof this.data.project.extra_question_answers === "object") ? this.data.project.extra_question_answers : {};
      const extraQuestionSteps = extraQuestions.map(q => ({
        id: "extra_" + q.id,
        type: "extra_question",
        title: q.title || "Project-specific question",
        text: q.help || "This is an optional project-specific question from Inkfire. If you are unsure, you can skip it for now.",
        question: q
      }));
      if (extraQuestionSteps.length) {
        const extraInsertAt = steps.findIndex(step => step.id === "staff_roster");
        steps.splice(extraInsertAt >= 0 ? extraInsertAt : Math.max(0, steps.length - 1), 0, ...extraQuestionSteps);
      }

      // Keep existing answer keys while combining related screens.
      const stepAliases = {tagline:'site_name',one_liner:'goals',blog_cats:'blog_toggle',shop_cats:'shop_toggle'};
      steps = steps.filter(step => !['blog_cats','shop_cats'].includes(step.id));
      steps.find(step => step.id === 'blog_toggle').categories = {target:'branding.blog_categories',label:'Blog topics (optional)',placeholder:'Type a topic and press Enter'};
      steps.find(step => step.id === 'shop_toggle').categories = {target:'branding.shop_categories',label:'Product categories (optional)',placeholder:'Type a category and press Enter'};
      steps.find(step => step.id === 'shop_toggle').options[1].label = 'No online shop needed';
      this.data.project.wizard_step = stepAliases[this.data.project.wizard_step] || this.data.project.wizard_step;
      this.data.project.skipped_steps = [...new Set((Array.isArray(this.data.project.skipped_steps) ? this.data.project.skipped_steps : []).map(id => stepAliases[id] || id))];
      // Build page sections before resolving saved progress or the section picker.
      const rebuildPageSteps = () => {
        steps = steps.filter(step => !String(step.id).startsWith("pg_content_"));
        const marker = steps.findIndex(step => step.id === "build_page_steps");
        const pageSteps = this.data.pages.map(p => ({ id: `pg_content_${p.id}`, type: "rich_wizard", title: p.title, text: `Add content and images for ${p.title}.`, pageId: p.id }));
        if (marker >= 0) steps.splice(marker + 1, 0, ...pageSteps);
      };
      rebuildPageSteps();
      if (this.data.pages.length) this.wizardState.pages = this.data.pages.map(p => ({ id:p.id, title:p.title, level:this.getLevel(p.id) }));
      let idx = Math.max(0, steps.filter(s=>s.type!=="build_page_steps"&&(!s.when||s.when())).findIndex(s => s.id === this.data.project.wizard_step));
      this.data.project.skipped_steps = Array.isArray(this.data.project.skipped_steps) ? this.data.project.skipped_steps : [];

      $el.html(`
        <div class="fco-wizard-stage" role="region" aria-label="Content onboarding wizard">
          <div class="fco-wizard-card">
            <div class="fco-wizard-topbar">
              <div class="fco-wizard-brand">
                <div class="fco-logo-mark" aria-hidden="true">
                    <img src="${logoUrl}" alt="Inkfire logo" style="width:100%; height:100%; object-fit:contain; border-radius:inherit;">
                </div>
                <div class="fco-wizard-brandtext">
                  <div class="fco-wizard-title">Inkfire Website Onboarder</div>
                </div>
              </div>
              <div class="fco-wizard-top-actions">
                <label class="fco-step-picker-label">Go to section<select id="wiz-jump" aria-label="Go to section"></select></label>
              </div>
            </div>
            <div class="fco-wizard-progress" aria-hidden="true">
              <div class="fill" style="width:0%"></div>
            </div>
            <div class="fco-wizard-body">
              <div class="fco-wizard-stepmeta" id="wiz-stepmeta"></div>
              <div class="fco-wizard-question" id="wiz-question" aria-hidden="true"></div><p id="wiz-question-accessible" class="fco-a11y-only"></p>
              <div class="fco-wizard-input" id="wiz-input"></div>
            </div>
            <div class="fco-wizard-footer">
              <button class="fco-btn ghost" id="wiz-back" type="button">Back</button>
              <button class="fco-btn ghost" id="wiz-skip" type="button">Skip for now</button><button class="fco-btn primary" id="wiz-next" type="button">Next <span aria-hidden="true">→</span></button>
            </div>
          </div>
        </div>
      `);

      this.mountWizardHeader($el);

      const $q = $("#wiz-question");
      const $input = $("#wiz-input");
      const $meta = $("#wiz-stepmeta");
      const $fill = $(".fco-wizard-progress .fill");
      // Cache buttons for performance
      const $next = $("#wiz-next");
      const $back = $("#wiz-back");

      // Wizard Nav Logic
      // Project-level saving and closing live in the portal shell, not the question header.

      const visibleSteps = () => steps.filter(s => s.type !== "build_page_steps" && (!s.when || s.when()));
      const stepCount = () => visibleSteps().length;
      const currentStep = () => visibleSteps()[idx];
      let renderedSectionFingerprint = "";
      const sectionFingerprint = () => JSON.stringify(this.data, (key, value) => (key === "_hub" || key === "_provenance") ? undefined : value);
      const provenanceSections = this.data._provenance.sections;
      const provenanceRecord = (s) => (s && provenanceSections[s.id] && typeof provenanceSections[s.id] === "object") ? provenanceSections[s.id] : null;
      const provenanceLabel = (s) => {
        const state = provenanceRecord(s)?.state || "unknown";
        const labels = {
          staff_prefilled: "Inkfire pre-filled · please confirm",
          client_confirmed: isAdmin ? "Confirmed by client" : "You confirmed this",
          client_changed: isAdmin ? "Changed by client" : "Your answers saved",
          skipped: "Skipped for now",
          unanswered: "Not answered",
          unknown: isAdmin ? "Existing answer · confirmation unknown" : "Ready for your review"
        };
        return {state, label: labels[state] || labels.unknown};
      };
      const setProvenance = (s, state) => {
        if (!s || ["intro","outro","build_page_steps"].includes(s.type)) return;
        provenanceSections[s.id] = {
          state,
          actor: isAdmin ? "staff" : "client",
          updated_at: new Date().toISOString()
        };
      };
      const visibleAnswerExists = () => {
        let found = false;
        $input.find("input,textarea,select").each((i, el) => {
          if (found || el.disabled) return;
          const type = String(el.type || "").toLowerCase();
          if (type === "checkbox" || type === "radio") { if (el.checked) found = true; return; }
          const value = $(el).val();
          if (Array.isArray(value) ? value.length : String(value ?? "").trim() !== "") found = true;
        });
        if (!found && $input.find(".fco-wiz-choice.active,.fco-chip,.fco-media-item,.fco-palette-strip,.fco-user-row,.fco-staff-card,.fco-page-row").length) found = true;
        return found;
      };
      const markChangedProvenance = (s) => setProvenance(s, isAdmin ? "staff_prefilled" : "client_changed");
      const captureChangedProvenance = () => {
        if (!$("#fco-client-app").hasClass("mode-wizard")) return;
        const s = currentStep();
        if (!s || !renderedSectionFingerprint) return;
        if (sectionFingerprint() !== renderedSectionFingerprint) markChangedProvenance(s);
      };
      this.updateWizardProvenanceBeforeSave = captureChangedProvenance;

      const updateProgress = () => {
        const total = stepCount();
        const pct = total <= 1 ? 0 : Math.round((idx / (total - 1)) * 100);
        $fill.css("width", `${pct}%`);
      };

      const setNavState = () => {
        $back.prop("disabled", idx <= 0);
        const s = currentStep();
        $("#wiz-skip").prop("hidden",["intro","outro","build_page_steps"].includes(s.type));
        const isLast = idx >= (stepCount() - 1);
        let btnText = "Next";
        if (s.type === "intro") btnText = "Get Started";
        else if (isLast || s.type === "outro") btnText = "Review content";
        $next.html(`${btnText} <span aria-hidden="true">→</span>`);
      };

      const typewriter = async (text) => {
          const myToken = ++typingToken;
          $q.attr({"data-typing":"1","aria-busy":"true"});
        
          // Clear first
          $q.text("");
        
          // If user prefers reduced motion, skip typing entirely
          const reduceMotion = (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
          if (reduceMotion) {
            $q.text(text);
            $q.removeAttr("data-typing").attr("aria-busy","false");
            return;
          }
        
          // Clamp speed a little based on length (longer text slightly faster)
          const len = text.length || 1;
          const speed = Math.max(TYPE_MIN_MS, Math.min(TYPE_MAX_MS, TYPE_BASE_MS - Math.floor(len / 250)));
        
          for (let i = 0; i < text.length; i++) {
            if (typingToken !== myToken || !$q[0].isConnected) return; // cancelled
            const ch = text[i];
            $q.text(text.slice(0,i+1));
        
            let extra = 0;
            if (ch === "\n") extra += TYPE_NEWLINE_BONUS;
            if (/[.!?]/.test(ch)) extra += TYPE_PUNCT_BONUS;
        
            await sleep(speed + extra);
          }
        
          $q.removeAttr("data-typing").attr("aria-busy","false");
      };
      
      const finishTypingNow = (s) => {
          // Cancel current typewriter loop
          typingToken++;
          $q.removeAttr("data-typing").attr("aria-busy","false");
        
          // If we have the step, instantly show full text
          if (s && s.text) $q.text(s.text);
      };
      
      const getValueByTarget = (target) => {
        if (!target) return null;
        const parts = target.split(".");
        if (this.data[parts[0]]) return this.data[parts[0]][parts[1]];
        return null;
      };

      const setValueByTarget = (target, val) => {
        if (!target) return;
        const parts = target.split(".");
        if (this.data[parts[0]]) this.data[parts[0]][parts[1]] = val;
      };

      // Reuse the components for wizard inputs (copied logic for stability)
      const renderInputForStep = (s) => {
        // Delegated handlers belong to one section, not every section visited.
        $input.off("input change click keydown");
        $input.empty();
        this.destroyWpEditor();
        this.lastWizardRenderKey = `${s.id}::${idx}`;
        if (this.renderGuidedStep && this.renderGuidedStep(s, $input, steps)) return;

        if (s.type === "intro") { $input.html(`<div class="fco-wiz-hint">Click <strong>Get Started</strong> to begin.</div>`); return; }
        if (s.type === "outro") { const skipped=this.data.project.skipped_steps; $input.html(`<div class="fco-wiz-hint">${skipped.length ? `${skipped.length} section(s) skipped. Use “Go to section” to return to them, or return to these sections later.` : "You can review and edit your answers from the dashboard."} Finishing does not publish your website.</div>`); return; }
        

        if (s.type === "extra_question") {
          const q = s.question || {};
          const answers = this.data.project.extra_question_answers || (this.data.project.extra_question_answers = {});
          const current = answers[q.id];
          const note = `<p class="fco-question-help"><strong>Optional.</strong> If you do not know yet, use <em>Skip for now</em> and come back later.</p>`;
          if (q.type === "text") {
            $input.html(`<label class="fco-question-label" for="wiz-extra-${this.escapeAttr(q.id)}">${this.escapeHtml(q.title || "Your answer")}</label><input class="fco-wiz-field fco-extra-answer-control" id="wiz-extra-${this.escapeAttr(q.id)}" type="text" maxlength="5000" value="${this.escapeAttr(typeof current === "string" ? current : "")}" autocomplete="off">${note}`);
            $input.find(".fco-extra-answer-control").on("input",e=>{answers[q.id]=e.target.value;this.debouncedSave();});
            return;
          }
          if (q.type === "single") {
            const options = Array.isArray(q.options) ? q.options : [];
            $input.html(`<fieldset class="fco-feature-options fco-extra-choice"><legend>${this.escapeHtml(q.title || "Choose one")}</legend>${options.map(option=>`<label><input type="radio" name="extra-${this.escapeAttr(q.id)}" value="${this.escapeAttr(option)}" ${current===option?"checked":""}> ${this.escapeHtml(option)}</label>`).join("")}</fieldset>${note}`);
            $input.find('input[type="radio"]').on("change",e=>{answers[q.id]=e.target.value;this.debouncedSave();});
            return;
          }
          if (q.type === "multi") {
            const options = Array.isArray(q.options) ? q.options : [];
            const selected = Array.isArray(current) ? current : [];
            $input.html(`<fieldset class="fco-feature-options fco-extra-choice"><legend>${this.escapeHtml(q.title || "Choose any that apply")}</legend>${options.map(option=>`<label><input type="checkbox" value="${this.escapeAttr(option)}" ${selected.includes(option)?"checked":""}> ${this.escapeHtml(option)}</label>`).join("")}</fieldset>${note}`);
            $input.find('input[type="checkbox"]').on("change",()=>{answers[q.id]=$input.find('input[type="checkbox"]:checked').map((i,e)=>e.value).get();this.debouncedSave();});
            return;
          }
          $input.html(`<label class="fco-question-label" for="wiz-extra-${this.escapeAttr(q.id)}">${this.escapeHtml(q.title || "Your answer")}</label><textarea class="fco-wiz-field fco-extra-answer-control" id="wiz-extra-${this.escapeAttr(q.id)}" rows="6" maxlength="5000">${this.escapeHtml(typeof current === "string" ? current : "")}</textarea>${note}`);
          $input.find(".fco-extra-answer-control").on("input",e=>{answers[q.id]=e.target.value;this.debouncedSave();});
          return;
        }

        if (s.type === 'features') {
          const choices=[['bookings','Bookings / appointments'],['memberships','Memberships / subscriptions'],['courses','Courses / learning'],['directory','Directory / listings'],['events','Events'],['forms','Forms / enquiries'],['multilingual','Multiple languages'],['custom','Custom workflow'],['unsure','Not sure yet']];
          $input.html(`<fieldset class="fco-feature-options"><legend>Features to discuss with Inkfire</legend>${choices.map(([value,label])=>`<label><input type="checkbox" value="${value}" ${(this.data.project.features||[]).includes(value)?'checked':''}> ${label}</label>`).join('')}</fieldset><p class="fco-question-help">${this.escapeHtml(s.help)}</p>`);
          $input.find('input').on('change',()=>{this.data.project.features=$input.find('input:checked').map((i,e)=>e.value).get();this.debouncedSave();});return;
        }
        if (s.type === 'grouped_fields') {
          $input.html(`<div class="fco-form-grid">${s.fields.map((field,i) => {
            const id = `wiz-group-${s.id}-${i}`;
            const value = getValueByTarget(field.target) || '';
            const attrs = `id="${id}" name="${id}" autocomplete="off" data-lpignore="true" class="fco-wiz-field fco-group-control" data-target="${this.escapeAttr(field.target)}" aria-describedby="${id}-help" maxlength="5000" placeholder="${this.escapeAttr(field.placeholder || '')}"`;
            const control = field.kind === 'textarea' ? `<textarea ${attrs} rows="3">${this.escapeHtml(value)}</textarea>` : `<input ${attrs} type="${field.kind === 'email' ? 'email' : 'text'}" value="${this.escapeAttr(value)}">`;
            return `<div class="fco-form-field${field.wide ? ' fco-field-wide' : ''}"><label for="${id}">${this.escapeHtml(field.label)}</label>${control}<p class="fco-question-help" id="${id}-help">${this.escapeHtml(field.help || '')}</p></div>`;
          }).join('')}</div>`);
          $input.find('.fco-group-control').on('input change',e => {setValueByTarget(e.target.dataset.target,e.target.value);this.debouncedSave();});
          return;
        }
        if (s.type === 'setup_fields') {
          const data=this.data.project;
          $input.html(`<div class="fco-form-grid">${s.fields.map(([key,label,help],i)=>`<div class="fco-form-field${i===s.fields.length-1 && s.fields.length%2 ? ' fco-field-wide' : ''}"><label for="wiz-setup-${key}">${this.escapeHtml(label)}</label><textarea class="fco-wiz-field fco-setup-control" id="wiz-setup-${key}" data-key="${key}" aria-describedby="wiz-help-${key}" rows="3" maxlength="5000">${this.escapeHtml(data[key]||'')}</textarea><p class="fco-question-help" id="wiz-help-${key}">${this.escapeHtml(help)}</p></div>`).join('')}</div>`);
          $input.find('textarea').on('input',e=>{data[e.target.dataset.key]=e.target.value;this.debouncedSave();});return;
        }
        // --- FIX FOR AUTOFILL & REUSED IDS ---
        if (s.type === "text" || s.type === "textarea") {
          const v = getValueByTarget(s.target) || "";
          const fieldId = `wiz-field-${s.id}`;
          
          // Added autocomplete attributes to prevent junk fill
          const commonAttrs = `id="${fieldId}" name="${fieldId}" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" data-lpignore="true"`;

          const field = s.type === "textarea" 
            ? `<textarea class="fco-wiz-field" ${commonAttrs} rows="4" placeholder="${this.escapeAttr(s.placeholder || "")}">${this.escapeHtml(v)}</textarea>`
            : `<input class="fco-wiz-field" ${commonAttrs} type="text" value="${this.escapeHtml(v)}" placeholder="${this.escapeAttr(s.placeholder || "")}">`;
          
          $input.html(`<label class="fco-question-label" for="${fieldId}">${this.escapeHtml(s.title)}</label>${s.help?`<p class="fco-question-help">${this.escapeHtml(s.help)}</p>`:""}<div class="fco-wiz-fieldrow">${field}</div>`);
          
          // Focus the unique ID and bind with delegation on $input
          $input.find(`#${fieldId}`).on("input",e=>{setValueByTarget(s.target,e.target.value);this.debouncedSave();}).focus();
          $input.off("keydown", `#${fieldId}`).on("keydown", `#${fieldId}`, (e) => { 
             if (e.key === "Enter" && s.type !== "textarea") { 
                 e.preventDefault(); 
                 $next.click(); 
             } 
          });
          return;
        }
        
        if(s.type === "admin_setup") {
            const p = this.data.project;
            $input.html(`
              <div class="fco-setup-fields">
                <label for="wiz-adm-email">Website notification email
                  <span class="fco-question-help">Where should important website and admin notifications be sent?</span>
                  <input class="fco-wiz-field" type="email" aria-label="Website notification email" id="wiz-adm-email" value="${this.escapeAttr(p.admin_email || '')}" placeholder="name@example.com">
                </label>
                <label for="wiz-adm-languages">Website language(s)
                  <span class="fco-question-help">Tell us the main language and any translations the website will need.</span>
                  <textarea class="fco-wiz-field" id="wiz-adm-languages" rows="3" maxlength="5000">${this.escapeHtml(p.languages || '')}</textarea>
                </label>
                <label for="wiz-adm-timezone">Business location and time zone
                  <span class="fco-question-help">Used for schedules, bookings and date/time settings.</span>
                  <textarea class="fco-wiz-field" id="wiz-adm-timezone" rows="3" maxlength="5000">${this.escapeHtml(p.timezone || '')}</textarea>
                </label>
              </div>`);
            $input.find("#wiz-adm-email,#wiz-adm-languages,#wiz-adm-timezone").on("input", () => {
              p.admin_email = String($("#wiz-adm-email").val() || "");
              p.languages = String($("#wiz-adm-languages").val() || "");
              p.timezone = String($("#wiz-adm-timezone").val() || "");
              this.debouncedSave();
            });
            $("#wiz-adm-email").focus();
            return;
        }

        // Contact Info, Socials, Staff, User Manager, Media Multiple, Brand Colours, Typo Selector
        // These are complex. To keep this file replacement valid, I am pasting the V16 logic here.
        if (s.type === "contact_info") {
            const c = this.data.branding.contact;
            // Updated for Task 3: Grid Layout
            $input.html(`
                <div class="fco-wiz-contact-grid">
                    <div class="fco-field-group">
                        <label class="fco-label">Business Address</label>
                        <textarea class="fco-wiz-field" aria-label="Business address" id="wiz-c-addr" style="min-height:100px; font-size:1.1rem;" placeholder="Full Address">${this.escapeHtml(c.address)}</textarea>
                    </div>
                    <div class="fco-field-group">
                        <label class="fco-label">Email Addresses (Type & Enter)</label>
                        <div class="fco-wiz-chipwrap"><input class="fco-input" aria-label="Business email addresses" id="wiz-c-email" placeholder="sales@example.com"><div class="fco-chiplist" id="wiz-list-email"></div></div>
                    </div>
                    <div class="fco-field-group">
                        <label class="fco-label">Phone Numbers (Type & Enter)</label>
                        <div class="fco-wiz-chipwrap"><input class="fco-input" aria-label="Business phone numbers" id="wiz-c-phone" placeholder="+44 1234 567890"><div class="fco-chiplist" id="wiz-list-phone"></div></div>
                    </div>
                </div>
            `);
            // Delegated binding
            $input.off("input", "#wiz-c-addr").on("input", "#wiz-c-addr", (e) => { c.address = $(e.target).val(); this.debouncedSave(); });
            const bindChips = (arr, inputId, listId) => {
                const render = () => { $input.find(`#${listId}`).html(arr.map((x,i) => `<span class="fco-chip">${this.escapeHtml(x)}<button class="fco-chip-x" data-i="${i}">×</button></span>`).join("")); };
                render();
                this.trackPendingInput?.(`#${inputId}`, inputId, () => $input.find(`#${inputId}`).trigger($.Event("keydown", {key:"Enter"})));
                $input.off("keydown", `#${inputId}`).on("keydown", `#${inputId}`, (e) => { 
                    if(e.key === "Enter"){ 
                        e.preventDefault(); 
                        const v = $(e.target).val().trim(); 
                        if(v){ arr.push(v); $(e.target).val(""); render(); this.debouncedSave(); } 
                    } 
                });
                $input.off("click", `#${listId} .fco-chip-x`).on("click", `#${listId} .fco-chip-x`, (e) => { arr.splice($(e.currentTarget).data("i"), 1); render(); this.debouncedSave(); });
            };
            bindChips(c.emails, "wiz-c-email", "wiz-list-email"); bindChips(c.phones, "wiz-c-phone", "wiz-list-phone");
            return;
        }

        if (s.type === "socials_manager") {
            // Updated for Task 4: Grid Layout
            const list = this.data.branding.socials;
            const render = () => {
                const html = list.map((soc, i) => `<div class="fco-typo-row"><input class="fco-typo-input" aria-label="Social platform" placeholder="Platform" value="${this.escapeAttr(soc.platform)}" data-i="${i}" data-k="platform" style="flex:0 0 40%;"><input class="fco-typo-input" aria-label="Social profile URL" placeholder="https://" value="${this.escapeAttr(soc.url)}" data-i="${i}" data-k="url" style="flex:1;"><button class="fco-mini danger del-soc" data-i="${i}">×</button></div>`).join("");
                $("#wiz-soc-list").html(html);
            };
            $input.html(`<div class="fco-wiz-socials-grid" style="width:100%;"><div id="wiz-soc-list"></div><button class="fco-btn ghost small full" id="wiz-add-soc" style="margin-top:10px;">+ Add Social Profile</button></div>`);
            render();
            // Delegated binding
            $input.off("click", "#wiz-add-soc").on("click", "#wiz-add-soc", () => { list.push({platform:"", url:""}); render(); this.debouncedSave(); });
            $input.off("click", ".del-soc").on("click", ".del-soc", (e) => { list.splice($(e.currentTarget).data("i"), 1); render(); this.debouncedSave(); });
            $input.off("input", ".fco-typo-input").on("input", ".fco-typo-input", (e) => { const el = $(e.currentTarget); list[el.data("i")][el.data("k")] = el.val(); this.debouncedSave(); });
            return;
        }

        // Delegate to new Dashboard renderers where appropriate to save code, but Wizard needs custom wrapping.
        // For safety, I will keep the V16 Wizard logic intact.
        if (s.type === "inspiration") {
            // Updated for Task 6: Inspiration Grid
            const b = this.data.branding;
            if (!Array.isArray(b.inspiration_links)) b.inspiration_links = [];
            while (b.inspiration_links.length < 6) b.inspiration_links.push("");
            
            $input.html(`
                <div style="width:100%;">
                    <div class="fco-label">Top 6 Inspiration Websites</div>
                    <div class="fco-wiz-insp-grid">
                        ${b.inspiration_links.map((lnk, i) => `<input aria-label="Inspiration website ${i+1}" class="fco-input insp-lnk" data-i="${i}" value="${this.escapeAttr(lnk)}" placeholder="https://">`).join("")}
                    </div>
                    <div class="fco-label">Design brief</div>
                    <textarea class="fco-input" aria-label="Design brief" id="wiz-style-notes" rows="4" placeholder="Describe your preferred style" style="width:100%; margin-bottom:20px;">${this.escapeHtml(b.style_notes||"")}</textarea>
                    <div style="border-top:1px solid #e2e8f0; padding-top:20px;">
                        <div class="fco-label">Brand Guidelines / Style Guide (PDF)</div>
                        <div id="wiz-brand-doc-preview" style="margin-bottom:10px; font-weight:600; color:#4f46e5;">${this.escapeHtml(b.brand_doc ? b.brand_doc.filename : "No file uploaded")}</div>
                        ${this.uploadZone('wiz-up-doc','Brand guidelines','Add an existing style guide or brand document.',true)}
                    </div>
                </div>
            `);
            // Delegated binding
            $input.off("input", ".insp-lnk").on("input", ".insp-lnk", (e) => { b.inspiration_links[$(e.target).data("i")] = $(e.target).val(); this.debouncedSave(); });
            $input.off("input", "#wiz-style-notes").on("input", "#wiz-style-notes", (e) => { b.style_notes = $(e.target).val(); this.debouncedSave(); });
            $input.off("click", "#wiz-up-doc").on("click", "#wiz-up-doc", (e, initialFiles = []) => { if(!wp.media) return; const frame = wp.media({ title: "Upload Brand Doc", button: {text:"Select"}, multiple: false, initialFiles }); frame.on("select", () => { const att = frame.state().get("selection").first().toJSON(); b.brand_doc = { id: att.id, url: att.url, filename: att.filename }; $("#wiz-brand-doc-preview").text(att.filename); this.saveData(true); }); frame.open(); });
            return;
        }

        if (s.type === "staff_manager") {
             $input.html(`<div style="width:100%; max-width:800px;"><div id="wiz-staff-list"></div><button class="fco-btn primary full" id="wiz-add-staff">+ Add Staff Member</button></div>`);
             this.renderStaffManager("#wiz-staff-list");
             $input.off("click", "#wiz-add-staff").on("click", "#wiz-add-staff", () => { this.data.content.staff.push({name:"", position:"", bio:"", image:""}); this.renderStaffManager("#wiz-staff-list"); this.debouncedSave(); });
             return;
        }

        if (s.type === "user_manager") {
            $input.html(`<div style="width:100%; max-width:900px;"><div id="wiz-user-list"></div><button class="fco-btn primary full" id="wiz-add-user">+ Add User</button></div>`);
            this.renderUserListManager("#wiz-user-list");
            $input.off("click", "#wiz-add-user").on("click", "#wiz-add-user", () => { this.data.project.wp_users.push({username:"", first_name:"", last_name:"", role:"editor"}); this.renderUserListManager("#wiz-user-list"); this.debouncedSave(); });
            return;
        }
        
        if (s.type === "choice") {
          const curr = getValueByTarget(s.target);
          const btns = (s.options || []).map(o => `<button type="button" class="fco-wiz-choice ${curr === o.value ? "active" : ""}" data-val="${String(o.value)}">${this.escapeHtml(o.label)}</button>`).join("");
          const categories = s.categories;
          $input.html(`<div class="fco-choice-panel"><div class="fco-wiz-choicebar" role="group" aria-label="${this.escapeAttr(s.title)}">${btns}</div>${categories ? `<div class="fco-inline-categories" ${curr === true ? '' : 'hidden'}><label class="fco-question-label" for="wiz-category-input">${this.escapeHtml(categories.label)}</label><input class="fco-wiz-field" id="wiz-category-input" placeholder="${this.escapeAttr(categories.placeholder)}"><div class="fco-chiplist" id="wiz-category-list"></div></div>` : ''}</div>`);
          if (categories) { const [group,key] = categories.target.split('.'); this.renderChipsManager(this.data[group],key,'#wiz-category-list','#wiz-category-input'); }
          if (['blog_toggle','shop_toggle'].includes(s.id)) $input.find('.fco-choice-panel').append('<p class="fco-scope-note"><strong>For Inkfire to review.</strong> Your agreed quote defines what is included. Selecting this does not approve extra work or enable it on your website.</p>');
          $input.find(".fco-wiz-choice").attr("aria-pressed", function(){return $(this).hasClass("active") ? "true" : "false";});
          $input.find(".fco-wiz-choice").on("click", (e) => { $input.find(".fco-wiz-choice").removeClass("active").attr("aria-pressed","false"); $(e.currentTarget).addClass("active").attr("aria-pressed","true");mapWizardStepValueToData(s);$input.find('.fco-inline-categories').prop('hidden',getValueByTarget(s.target)!==true);this.debouncedSave(); });
          return;
        }
        
        if (s.type === "chips") {
            // Re-use logic but adapted for wizard state
            const existing = Array.isArray(getValueByTarget(s.target)) ? getValueByTarget(s.target) : [];
            const renderChips = () => { $("#wiz-chiplist").html(existing.map((c, i) => `<span class="fco-chip">${this.escapeHtml(c)}<button type="button" class="fco-chip-x" data-i="${i}">×</button></span>`).join("") || `<div class="fco-wiz-hint">Nothing added yet.</div>`); };
            $input.html(`<div class="fco-wiz-chipwrap"><div class="fco-wiz-fieldrow"><input class="fco-wiz-field" aria-label="${this.escapeAttr(s.title)}" id="wiz-chipin" type="text" placeholder="${this.escapeAttr(s.placeholder)}" /></div><div class="fco-chiplist" id="wiz-chiplist"></div></div>`);
            renderChips();
            $input.off("keydown", "#wiz-chipin").on("keydown", "#wiz-chipin", (e) => { if (e.key === "Enter") { e.preventDefault(); const v = String($(e.target).val()||"").trim(); if (v) { existing.push(v); $(e.target).val(""); renderChips(); this.debouncedSave(); } } });
            $input.off("click", ".fco-chip-x").on("click", ".fco-chip-x", (e) => { existing.splice($(e.currentTarget).data("i"), 1); renderChips(); this.debouncedSave(); });
            this.trackPendingInput?.("#wiz-chipin", s.target.split(".").pop(), () => $("#wiz-chipin").trigger($.Event("keydown", {key:"Enter"})));
            this.wizardState[s.target] = existing;
            setValueByTarget(s.target, existing);
            return;
        }
        
        if (s.type === "media_multiple") {
            $input.html(`<div class="fco-wiz-media">${this.uploadZone('wiz-upload','Add your brand files','Logos, icons, brand documents and any existing artwork. Up to 20 MB per file.')}<div class="fco-media-grid" id="wiz-mediagrid"></div></div>`);
            this.renderAssetManager("#wiz-mediagrid");
            $input.off("click", "#wiz-upload").on("click", "#wiz-upload", (e, initialFiles = []) => {
                if (!window.wp || !wp.media) return;
                const frame = wp.media({ title: "Select Branding", button: {text:"Add"}, multiple: true, initialFiles });
                frame.on("select", () => {
                  const selection = frame.state().get("selection");
                  selection.map(att => { const json = att.toJSON(); if (!this.data.branding.assets.some(a => a.id === json.id)) this.data.branding.assets.push(json); });
                  this.renderAssetManager("#wiz-mediagrid"); this.saveData(true);
                });
                frame.open();
            });
            return;
        }

        if (s.type === "brand_colours_pantone") {
             // Task 5: Width Fix
             $input.html(`<div id="wiz-palette-wrap"></div>`);
             this.renderPaletteManager("#wiz-palette-wrap");
             return;
        }
        
        if (s.type === "typography_selector") {
             $input.html(`<div class="fco-typo-grid" id="wiz-typo-wrap"></div>`);
             this.renderTypoManager("#wiz-typo-wrap");
             return;
        }

        if (s.type === "brand_summary") {
          const b = this.data.branding;
          const logoAsset = (b.assets||[]).find(a=>a.client_purpose==='logo') || (b.assets||[]).find(a=>a.type==='image');
          const logo = logoAsset ? `<img src="${this.escapeAttr(logoAsset.url)}" alt="${this.escapeAttr(logoAsset.filename||'Brand image')}" style="max-height:80px; object-fit:contain;"><p>${logoAsset.client_purpose==='logo'?'Your suggested main logo':'Brand reference — main logo not specified'}. Inkfire reviews its use before delivery.</p>` : `<p>${b.assets?.length?'Brand files attached; no image preview available.':'No brand files attached yet. Upload, then choose Use selected files.'}</p>`;
          const fontsHtml = (b.fonts || []).filter(f=>f.name).map(f => `<div class="fco-summary-font-row"><strong style="color:#0f172a;">${this.escapeHtml(this.fontRoleLabel(f))}:</strong> ${this.escapeHtml(f.name)}</div>`).join("");
          const colorsHtml = b.colours_by_inkfire === true
            ? '<div class="fco-colour-summary-note">Brand colours<strong>Inkfire to choose</strong></div>'
            : (b.colors||[]).map(c => `<div class="fco-summary-color-strip" style="background:${this.escapeAttr(c.hex)};" title="${this.escapeAttr(c.name)} - ${this.escapeAttr(c.hex)}"></div>`).join("");

          // Redesigned Grid Layout
          $input.html(`
            <div class="fco-summary-grid">
                <div class="fco-summary-col-colors">
                    ${colorsHtml}
                </div>
                <div class="fco-summary-details">
                    <div>
                        <h2 class="fco-summary-h1">${this.escapeHtml(b.company_name || "Company Name")}</h2>
                        <div class="fco-summary-tag">${this.escapeHtml(b.tagline || "")}</div>
                    </div>
                    <div class="fco-summary-section">
                        <div class="fco-summary-label">Brand Mark</div>
                        <div>${logo}</div>
                    </div>
                    <div class="fco-summary-section">
                        <div class="fco-summary-label">Typography</div>
                        ${fontsHtml || '<div style="color:#94a3b8;">No fonts selected</div>'}
                    </div>
                </div>
            </div>
          `);
          return;
        }

        if (s.type === "page_builder") {
          if (!Array.isArray(this.wizardState.pages)) { this.wizardState.pages = [ { id: this.uid("p"), title: "Home", level: 0 }, { id: this.uid("p"), title: "Contact", level: 0 } ]; }
          const persistStructure = () => { this.syncWizardPagesToData(); rebuildPageSteps(); };
          const renderList = () => {
            const items = this.wizardState.pages.map(p => `<li class="fco-pageitem" data-id="${this.escapeAttr(p.id)}" data-level="${p.level}"><div class="fco-pageitem-inner" style="margin-left:${p.level * 20}px"><span class="fco-drag" aria-hidden="true">⋮⋮</span><span class="fco-title" contenteditable="true" role="textbox">${this.escapeHtml(p.title)}</span><div class="fco-pageactions"><button type="button" class="fco-mini" data-act="up" aria-label="Move ${this.escapeAttr(p.title)} up">↑</button><button type="button" class="fco-mini" data-act="down" aria-label="Move ${this.escapeAttr(p.title)} down">↓</button><button type="button" class="fco-mini" data-act="outdent">←</button><button type="button" class="fco-mini" data-act="indent">→</button><button type="button" class="fco-mini danger" data-act="delete">×</button></div></div></li>`).join("");
            $("#wiz-pages").html(items || `<li class="fco-wiz-hint">Add at least one page.</li>`);
            $("#wiz-pages .fco-title").off("input").on("input", (e) => { const id = $(e.currentTarget).closest(".fco-pageitem").data("id"); const page = this.wizardState.pages.find(x => x.id === id); if(page) { page.title = $(e.currentTarget).text().trim() || "Untitled"; persistStructure(); } });
            $("#wiz-pages .fco-mini").off("click").on("click", (e) => {
               const act = $(e.currentTarget).data("act"); const id = $(e.currentTarget).closest(".fco-pageitem").data("id"); const i = this.wizardState.pages.findIndex(x => x.id === id); if(i<0) return;
               if(act==='up'||act==='down') { this.wizardState.pages=this.reorderBranch(this.wizardState.pages,id,act==='up'?-1:1,p=>Number(p.level)||0); persistStructure(); renderList(); $('#wiz-pages').find(`.fco-pageitem[data-id="${this.cssEscape(id)}"] [data-act="${act}"]`).trigger('focus'); return; }
               if(act==="delete") { const removed=this.wizardState.pages[i]; if(!confirm(`Remove "${removed.title}" from the sitemap? Child pages will move up one level. Its saved content is retained.`))return; for(let j=i+1;j<this.wizardState.pages.length&&this.wizardState.pages[j].level>removed.level;j++)this.wizardState.pages[j].level--; this.wizardState.pages.splice(i, 1); persistStructure(); renderList(); $('#wiz-pagein').trigger('focus'); return; }
               if(act==="indent" && i>0) { this.wizardState.pages[i].level = Math.min(3, this.wizardState.pages[i-1].level+1); persistStructure(); renderList(); }
               if(act==="outdent") { this.wizardState.pages[i].level = Math.max(0, this.wizardState.pages[i].level-1); persistStructure(); renderList(); }
            });
            if ($.fn.sortable) { try { $("#wiz-pages").sortable("destroy"); } catch(e){} $("#wiz-pages").sortable({ handle: ".fco-drag", stop: (e, ui) => { const newOrder = []; $("#wiz-pages").children(".fco-pageitem").each((_, li) => { const id = $(li).data("id"); const found = this.wizardState.pages.find(x => x.id === id); if(found) newOrder.push(found); }); this.wizardState.pages = newOrder; persistStructure(); } }); }
          };
          $input.html(`<div class="fco-pagebuilder"><div class="fco-pageadd"><input class="fco-wiz-field" aria-label="Page name" id="wiz-pagein" type="text" placeholder="e.g. Services" autocomplete="off" /><button type="button" class="fco-btn primary" id="wiz-addpage">Add</button></div><ul class="fco-pagelist" id="wiz-pages"></ul></div>`);
          const addPageFromInput = () => { const v = String($("#wiz-pagein").val() || "").trim(); if (!v) return; this.wizardState.pages.push({ id: this.uid("p"), title: v, level: 0 }); $("#wiz-pagein").val(""); persistStructure(); renderList(); };
          $input.off("click", "#wiz-addpage").on("click", "#wiz-addpage", addPageFromInput); 
          $input.off("keydown", "#wiz-pagein").on("keydown", "#wiz-pagein", (e) => { if (e.key === "Enter") { e.preventDefault(); addPageFromInput(); } }); 
          this.trackPendingInput?.("#wiz-pagein", "page_name", addPageFromInput);
          renderList();
          return;
        }
        
        if (s.type === "rich_wizard") {
          // Task 10: Rich Wizard Width Fix
          const pageId = s.pageId; const contentKey = `${pageId}::main`;
          if (!this.data.drafts[contentKey]) this.data.drafts[contentKey] = { content: "" };
          if (!this.data.drafts[pageId]) this.data.drafts[pageId] = {};
          if (!Array.isArray(this.data.drafts[pageId].images)) this.data.drafts[pageId].images = [];
          const html = this.data.drafts[contentKey].content || "";
          $input.html(`<div class="fco-wiz-rich-container"><div class="fco-split-stage"><div class="fco-wiz-rich"><div class="fco-wiz-hint" style="text-align:left; margin-bottom:10px;">Page Content</div><textarea id="wiz-rich-area" class="fco-wiz-richarea">${this.escapeHtml(html)}</textarea></div><div class="fco-wiz-rich"><div class="fco-label" style="text-align:left;">Page Images / References</div>${this.uploadZone('wiz-add-img','Images for this page','Add photos, illustrations or visual references.',true)}<div class="fco-media-grid" id="wiz-page-imgs"></div></div></div></div>`);
          const brief = this.data.drafts[pageId];
          if (brief.goal || brief.notes) {
            $input.find('.fco-wiz-rich-container').prepend(`<aside class="fco-page-brief" aria-labelledby="fco-page-brief-title"><h2 id="fco-page-brief-title">Your starting brief for this page</h2>${brief.goal ? `<p>${this.escapeHtml(brief.goal)}</p>` : ''}${brief.notes ? `<p>${this.escapeHtml(brief.notes)}</p>` : ''}<p class="fco-page-brief-hint">Use this as a guide for the copy and files you add below.</p></aside>`);
          }
          this.initWpEditor("wiz-rich-area", { onChange: (newHtml) => { this.data.drafts[contentKey].content = newHtml; if ((!this.data.drafts[pageId].status || this.data.drafts[pageId].status === "empty") && String(newHtml).replace(/<[^>]*>/g," ").trim()) this.data.drafts[pageId].status = "draft"; this.debouncedSave(); } });
          const renderPageImages = () => { const imgs = this.data.drafts[pageId].images; $("#wiz-page-imgs").html(imgs.map((img, i) => `<div class="fco-media-item"><img src="${this.escapeAttr(img.url)}"><button class="fco-media-x" data-i="${i}">×</button></div>`).join("")); };
          renderPageImages();
          $input.off("click", "#wiz-add-img").on("click", "#wiz-add-img", (e, initialFiles = []) => { const frame = wp.media({ multiple: true, initialFiles }); frame.on("select", () => { const selection = frame.state().get("selection"); selection.map(att => this.data.drafts[pageId].images.push({ id: att.id, url: att.attributes.url })); renderPageImages(); this.saveData(true); }); frame.open(); });
          $input.off("click", "#wiz-page-imgs .fco-media-x").on("click", "#wiz-page-imgs .fco-media-x", (e) => { this.data.drafts[pageId].images.splice($(e.currentTarget).data("i"), 1); renderPageImages(); this.saveData(true); });
          return;
        }

        if (s.type === "build_page_steps") {
           this.syncWizardPagesToData();
           steps = steps.filter(step => !String(step.id).startsWith("pg_content_"));
           const perPageSteps = [];
           this.data.pages.forEach(p => { perPageSteps.push({ id: `pg_content_${p.id}`, type: "rich_wizard", title: p.title, text: `Add content and images for ${p.title}.`, pageId: p.id }); });
           const insertAt = steps.findIndex(x => x.id === "build_page_steps");
           if (insertAt >= 0) steps.splice(insertAt + 1, 0, ...perPageSteps);
           setTimeout(() => { $next.click(); }, 100);
           return;
        }
      };

      const mapWizardStepValueToData = (s) => {
        this.flushPendingInputs?.();
        if (s.type === 'grouped_fields') { $input.find('.fco-group-control').each((i,field) => setValueByTarget(field.dataset.target,field.value)); return; }
        if (s.type === "admin_setup") { this.data.project.admin_email = String($("#wiz-adm-email").val() || ""); this.data.project.languages = String($("#wiz-adm-languages").val() || ""); this.data.project.timezone = String($("#wiz-adm-timezone").val() || ""); return; }
        if (s.type === "extra_question") {
          const q = s.question || {};
          const answers = this.data.project.extra_question_answers || (this.data.project.extra_question_answers = {});
          if (q.type === "multi") {
            answers[q.id] = $input.find('input[type="checkbox"]:checked').map((i,e)=>e.value).get();
          } else if (q.type === "single") {
            answers[q.id] = String($input.find('input[type="radio"]:checked').val() || "");
          } else {
            answers[q.id] = String($input.find(".fco-extra-answer-control").val() || "");
          }
          return;
        }
        if (!s.target) return;
        if (s.type === "chips") { setValueByTarget(s.target, this.wizardState[s.target]); return; }
        if (s.type === "choice") { const $active = $input.find(".fco-wiz-choice.active"); const raw = $active.length ? $active.data("val") : null; if (raw !== null && raw !== undefined) { const val = (raw === "true") ? true : (raw === "false" ? false : raw); setValueByTarget(s.target, val); } return; }
        
        // --- FIX FOR MAPPING DYNAMIC IDs ---
        if (s.type === "text" || s.type === "textarea") { 
            const fieldId = `wiz-field-${s.id}`;
            const $f = $input.find(`#${fieldId}`);
            // Safety check: if field exists, get val, else empty string
            const v = $f.length ? String($f.val() || "") : "";
            setValueByTarget(s.target, v); 
            return; 
        }
      };

      const renderStep = async () => {
        const s = currentStep();
        if (!s) return;
        
        $el.attr({"data-wizard-step":s.id,"data-wizard-type":s.type});
        updateProgress();
        setNavState();
        
        const provenance = provenanceLabel(s);
        $meta.html(`<div class="fco-wiz-stepnum">Step ${idx + 1} of ${stepCount()}</div><span class="fco-provenance-badge state-${this.escapeAttr(provenance.state)}">${this.escapeHtml(provenance.label)}</span><h1 class="fco-wiz-steptitle" id="wiz-section-heading" tabindex="-1" aria-describedby="wiz-question-accessible">${this.escapeHtml(s.title || "")}</h1>`);
        
        // Remember navigation position only. Merely viewing a section is not confirmation.
        this.data.project.wizard_step = s.id;
        // RENDER UI FIRST (Task C1)
        renderInputForStep(s);
        renderedSectionFingerprint = sectionFingerprint();
        this.debouncedSave();
        const skipped=this.data.project.skipped_steps;
        $('#wiz-jump').html(visibleSteps().filter(x=>x.type!=='build_page_steps').map(x=>`<option value="${this.escapeAttr(x.id)}" ${x.id===s.id?'selected':''}>${this.escapeHtml(x.title)}${skipped.includes(x.id)?' — skipped':''}</option>`).join(''));
        $('#wiz-jump').append('<optgroup label="Workspace"><option value="_fco_dashboard">Content dashboard</option></optgroup>');
        document.dispatchEvent(new CustomEvent('fco:steps',{detail:visibleSteps().map(x=>({id:x.id,title:x.title}))}));

        
        // Announce the complete question once; the visual typing effect stays decorative.
        $('#wiz-question-accessible').text(s.text || '');
        document.getElementById('wiz-section-heading')?.focus({preventScroll:true});
        typewriter(s.text || "");
      };

      const goNext = async (skip = false) => {
          if ($q.attr("data-typing")) { finishTypingNow(currentStep()); if(!skip)return; }
          if (navLocked) return;

          const s = currentStep();
          if (!s) return;

          // If typing is in progress, first click finishes typing (does NOT advance)
          if ($q.attr("data-typing")) {
            finishTypingNow(s);
            return;
          }

          this.flushPendingInputs?.();
          if (!skip && s.type === "page_builder") { const pages = Array.isArray(this.wizardState.pages) ? this.wizardState.pages : []; if (!pages.length) { $input.find(".fco-wiz-hint").first().text("Please add at least one page to continue."); return; } }

          navLocked = true;
          $next.prop("disabled", true).addClass("is-busy");

          try {
            // Skipping keeps any answers already entered and remains revisitable.
            this.data.project.skipped_steps=this.data.project.skipped_steps.filter(id=>id!==s.id);
            if(skip)this.data.project.skipped_steps.push(s.id);
            mapWizardStepValueToData(s);
            if (s.type === "page_builder") { this.syncWizardPagesToData(); rebuildPageSteps(); }

            const changed = renderedSectionFingerprint && sectionFingerprint() !== renderedSectionFingerprint;
            if (skip) {
              setProvenance(s, "skipped");
            } else if (changed) {
              markChangedProvenance(s);
            } else if (!isAdmin && !["intro","outro","build_page_steps"].includes(s.type)) {
              // Next is an explicit client confirmation only when the section visibly contains an answer.
              // Blank sections remain unanswered; opening them alone changes nothing.
              setProvenance(s, visibleAnswerExists() ? "client_confirmed" : "unanswered");
            }

            if (!(await this.saveData(true))) return;

            // Advance exactly once
            idx++;

            if (idx >= stepCount()) {
              this.data.project.wizard_complete = true;
              if (!(await this.saveData(true))) return;
              this.switchMode("editor");
              return;
            }

            await renderStep();

          } finally {
            navLocked = false;
            $next.prop("disabled", false).removeClass("is-busy");
          }
      };
      
      const goBack = async () => {
          if (navLocked) return;

          // Cancel typing and show full text instead of jumping mid-animation
          const s = currentStep();
          if ($q.attr("data-typing")) finishTypingNow(s);

          navLocked = true;
          $back.prop("disabled", true).addClass("is-busy");

          try {
            mapWizardStepValueToData(s);
            if (s.type === "page_builder") { this.syncWizardPagesToData(); rebuildPageSteps(); }
            if (renderedSectionFingerprint && sectionFingerprint() !== renderedSectionFingerprint) markChangedProvenance(s);
            if (!(await this.saveData(true))) return;
            idx = Math.max(0, idx - 1);
            await renderStep();
          } finally {
            navLocked = false;
            $back.removeClass("is-busy");setNavState();
          }
      };
      
      // Bind once (Task B3)
      $next.off("click.fcoWizard").on("click.fcoWizard", ()=>goNext(false));
      $("#wiz-skip").off("click.fcoWizard").on("click.fcoWizard",()=>goNext(true));
      $("#wiz-jump").on("change",async e=>{
        if(navLocked)return;
        const target=e.target.value;navLocked=true;
        try{
          const leaving=currentStep();finishTypingNow(leaving);mapWizardStepValueToData(leaving);
          if(leaving.type==="page_builder"){this.syncWizardPagesToData();rebuildPageSteps();}
          if(renderedSectionFingerprint && sectionFingerprint()!==renderedSectionFingerprint) markChangedProvenance(leaving);
          if(!(await this.saveData())){e.target.value=leaving.id;return;}
          if(target==='_fco_dashboard'){this.switchMode('editor');return;}
          idx=Math.max(0,visibleSteps().findIndex(s=>s.id===target));await renderStep();
        }finally{navLocked=false;}
      });
      $back.off("click.fcoWizard").on("click.fcoWizard", goBack);
      
      $(document).off("keydown.fcoWizard").on("keydown.fcoWizard", (e) => { if (!$("#fco-client-app").hasClass("mode-wizard")) return; if (e.key === "Escape") { $("#wiz-suggest").empty().hide(); } });
      renderStep();
    },

    syncWizardPagesToData: function () {
      if (!Array.isArray(this.wizardState.pages)) return;
      const list = this.wizardState.pages;
      this.data.pages = []; const stack = []; const base = Date.now();
      list.forEach((item, i) => {
        const level = Math.max(0, Math.min(3, parseInt(item.level, 10) || 0));
        const parent = level === 0 ? null : (stack[level - 1] || null);
        stack[level] = item.id; stack.length = level + 1;
        this.data.pages.push({ id: item.id, title: item.title || "Untitled", parent: parent, sort: i });
        if (!this.data.drafts[item.id]) this.data.drafts[item.id] = { status: "empty", goal: "", notes: "" };
      });
      this.debouncedSave();
    },

    // ------------------------------------------------------------
    // UTILITIES & SYNC
    // ------------------------------------------------------------
    initWpEditor: function (id, conf) {
      if (!window.wp || !wp.editor || !wp.editor.initialize) { const $el = $(`#${this.cssEscape(id)}`); if($el.length) $el.on("input", () => conf.onChange($el.val())); return; }
      try { wp.editor.remove(id); } catch (e) {}
      wp.editor.initialize(id, {
        tinymce: { wpautop: true, menubar: true, toolbar1: "formatselect,bold,italic,underline,bullist,numlist,blockquote,link,unlink,removeformat", toolbar2: "undo,redo,fullscreen", plugins: "lists,link,paste,wordpress,wplink,fullscreen", setup: (ed) => { ed.on("Change KeyUp SetContent", () => conf.onChange(ed.getContent())); } },
        quicktags: true, mediaButtons: true
      });
      $(`#${this.cssEscape(id)}`).off("input.fcoWp").on("input.fcoWp", () => conf.onChange($(id).val()));
    },
    destroyWpEditor: function () { if (this.wpEditorId && window.wp && wp.editor) try { wp.editor.remove(this.wpEditorId); } catch (e) {} this.wpEditorId = null; },
    exportJson: function () { const b = new Blob([JSON.stringify(this.data, null, 2)], { type: "application/json" }); const a = document.createElement("a"); a.href = URL.createObjectURL(b); a.download = "content-onboard-backup.json"; a.click(); },
    importJson: function (e) {
      const f = e.target.files && e.target.files[0]; if (!f) return;
      const r = new FileReader(); r.onload = async (evt) => {
        try {
          let j = JSON.parse(evt.target.result);
          if (!j || !Array.isArray(j.pages)) { alert("Invalid JSON file: Missing 'pages' array."); return; }
          j.project = j.project || {}; j.branding = j.branding || {}; j.content = j.content || {}; j.drafts = j.drafts || {}; j.pages = Array.isArray(j.pages) ? j.pages : [];
          if (FCO_Config.isAdmin) { j.project.wizard_complete = true; }
          this.data = j; $(".fco-save-indicator").text("Importing...");
          await this.apiPost("/project/save", { project_id: FCO_Config.projectId, data: this.data });
          this.setSaveState("saved"); alert("Import successful! Reloading."); window.location.reload();
        } catch (err) { console.error(err); alert("Error: " + err.message); this.setSaveState("error"); }
      }; r.readAsText(f); e.target.value = "";
    },
    saveData: function (s) { if (typeof this.updateWizardProvenanceBeforeSave === "function") this.updateWizardProvenanceBeforeSave(); if (!s) this.setSaveState("saving"); return this.apiPost("/project/save", { project_id: FCO_Config.projectId, data: this.data }).done(() => !s && this.setSaveState("saved")).fail(() => !s && this.setSaveState("error")); },
    debouncedSave: function () { clearTimeout(this.saveTimer); this.saveTimer = setTimeout(() => this.saveData(true), 450); },
    setSaveState: function (s) { $(".fco-save-indicator").text(s === "saving" ? "Saving..." : (s === "error" ? "Error" : "Saved")).removeClass("is-saving is-error").addClass(s === "saving" ? "is-saving" : (s === "error" ? "is-error" : "")); },
    uid: function (p) { return `${p}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`; },
    cssEscape: function (s) { return String(s || "").replace(/([ #;?%&,.+*~\':"!^$[\]()=>|\/@])/g, "\\$1"); },
    escapeHtml: function (s) { return String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;"); },
    escapeAttr: function (s) { return this.escapeHtml(s); }
  };
  window.FCO_App = App;
  $(document).ready(() => { if (!window.FCO_Config || !FCO_Config.hub) App.init(); });
})(jQuery);